import { join } from "jsr:@std/path@1.0.8";
import { exists } from "jsr:@std/fs@1.0.14";
import {
  DEFAULT_GLOBAL_CONFIG,
  loadGlobalConfig,
  merge,
  parseYamlWithVariables,
} from "./lib/config.ts";
import {
  CharacterConfig,
  DeepPartial,
  GlobalConfig,
  Issue,
  PlatformSdk,
} from "./types.ts";
import {
  generateText,
  getModel,
  tool,
  jsonSchema,
  ToolSet,
} from "./lib/llm.ts";
import { CoreMessage, LanguageModelV1 } from "npm:ai@4.1.54";
import { McpHub } from "./lib/mcp.ts";
import {
  BRANCH,
  OWNER,
  REPO,
  WORKSPACE,
  getPlatformSdk,
} from "./platform/index.ts";

export const DEFAULT_CHARACTER_CONFIG: CharacterConfig = {
  ...DEFAULT_GLOBAL_CONFIG,
  name: "",
  labels: [],
  systemPrompt: "",
};

const CONTEXT = {
  WORKSPACE,
  REPO,
  OWNER,
  CURRENT_BRANCH: BRANCH,
};

export class Character {
  private config: CharacterConfig;
  private mcpHub: McpHub;
  private sdk: PlatformSdk;

  constructor(config: DeepPartial<CharacterConfig>) {
    if (!config.name) {
      throw new Error("name is required in character config");
    }

    this.config = merge(DEFAULT_CHARACTER_CONFIG, config);
    this.mcpHub = new McpHub({
      servers: this.config.mcp.servers,
    });
    this.sdk = getPlatformSdk();
  }

  get name(): string {
    return this.config.name;
  }

  get model() {
    return getModel(this.config.llm.provider, this.config.llm.model);
  }

  get unstableModelPreferences() {
    return Object.keys(
      this.config.llm.__unstable_model_preferences || {}
    ).reduce<
      Partial<
        Record<
          keyof Exclude<
            GlobalConfig["llm"]["__unstable_model_preferences"],
            undefined
          >,
          LanguageModelV1
        >
      >
    >((prev, cur) => {
      const preference =
        this.config.llm.__unstable_model_preferences?.[cur as "bestCost"];
      if (preference) {
        prev[cur as "bestCost"] = getModel(
          preference.provider,
          preference.model
        );
      }
      return prev;
    }, {});
  }

  public async initialize() {
    await this.mcpHub.connect({
      model: this.model,
      unstableModelPreferences: this.unstableModelPreferences,
      maxRetries: this.config.llm.maxRetries,
    });
  }

  public async finalize() {
    await this.mcpHub.disconnect();
  }

  public matchesLabels(issueLabels: Issue["labels"]): boolean {
    const issueLabelSet = new Set(issueLabels.map((label) => label.name));

    return this.config.labels.some((label) => issueLabelSet.has(label));
  }

  private issueToPrompt(issue: Issue): {
    messages: CoreMessage[];
  } {
    return {
      messages: [
        {
          role: "system",
          content: `<context>${JSON.stringify({
            ...CONTEXT,
            ISSUE_ID: issue.id,
            CURRENT_TIME: new Date().toISOString(),
          })}</context>
<character>${this.config.systemPrompt}</character>`,
        },
        {
          role: "user",
          content: `<title>${issue.title}</title><content>${issue.content}</content>`,
        },
        ...issue.comments
          // .filter((c) => !c.content.includes("[INTERNAL]"))
          .map((c) => {
            const m: CoreMessage = {
              role: "user",
              content: c.content,
            };

            return m;
          }),
      ],
    };
  }

  public async doTask(issue: Issue) {
    const { messages } = this.issueToPrompt(issue);
    const tools = await this.mcpHub.listTools();

    const { text, steps } = await generateText({
      model: this.model,
      messages,
      tools: tools.reduce((acc, t) => {
        // console.log("appending", t.name, t.description);
        acc[t.name] = tool({
          description: t.description,
          parameters: jsonSchema(t.inputSchema),
          execute: async (input) => {
            console.log("going to execute", { name: t.name, input });
            try {
              const { content } = await t.client.callTool(
                {
                  name: t.name,
                  arguments: input as unknown as Record<string, string>,
                },
                undefined,
                {
                  timeout: 600_000,
                }
              );

              return JSON.stringify(content);
            } catch (error: any) {
              console.error(error);
              return JSON.stringify({
                error: {
                  message: error?.message,
                  name: error?.name,
                  stack: error?.stack,
                  ...error,
                },
              });
            }
          },
        });
        return acc;
      }, {} as ToolSet),
      maxSteps: this.config.llm.maxSteps,
      temperature: this.config.llm.temperature,
      maxTokens: this.config.llm.maxTokens,
      maxRetries: this.config.llm.maxRetries,
      onStepFinish: async (result) => {
        console.debug("debug:", result);
        const parts: string[] = [result.text].concat(
          result.toolCalls
            .map((tc) => {
              return `[INTERNAL]Tool Call:
\`\`\`json
${JSON.stringify(
  {
    toolName: tc.toolName,
    args: tc.args,
    toolCallId: tc.toolCallId,
  },
  null,
  2
)}
\`\`\``;
            })
            .concat(
              result.toolResults.map((tr) => {
                const { toolName, result, toolCallId } = tr as unknown as {
                  toolName: string;
                  result: unknown;
                  toolCallId: string;
                };
                return `[INTERNAL]Tool Result:
\`\`\`json
${JSON.stringify(
  {
    toolName,
    result,
    toolCallId,
  },
  null,
  2
)}
\`\`\``;
              })
            )
        );
        await this.addInternalMessages(issue, parts);
      },
    });

    return {
      text,
      steps,
    };
  }

  private async addInternalMessages(issue: Issue, parts: string[]) {
    return await this.sdk.createIssueComment(
      issue,
      `[Dewhale]\n${parts.filter(Boolean).join("\n\n")}`
    );
  }
}

export async function loadAllCharacters(
  basePath: string,
  data: Record<string, string>
): Promise<Character[]> {
  const characters: Character[] = [];
  const charactersDir = join(basePath, ".dewhale", "characters");
  const globalConfig = await loadGlobalConfig(basePath, data);

  try {
    if (await exists(charactersDir)) {
      for await (const entry of Deno.readDir(charactersDir)) {
        const isYaml =
          entry.name.endsWith(".yaml") || entry.name.endsWith(".yml");
        if (entry.isFile && isYaml) {
          try {
            const filePath = join(charactersDir, entry.name);
            const content = await Deno.readTextFile(filePath);
            const config = parseYamlWithVariables(
              content,
              data
            ) as CharacterConfig;
            characters.push(new Character(merge(globalConfig, config)));
            console.log(`character "${config.name}" loaded`);
          } catch (error) {
            console.error(`failed to load character "${entry.name}":`, error);
          }
        }
      }
    } else {
      console.warn(`characters config folder "${charactersDir} not exists"`);
    }
  } catch (error) {
    console.error(`failed to load characters:`, error);
  }

  return characters;
}
