import { Client } from "npm:@modelcontextprotocol/sdk@1.6.1/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "npm:@modelcontextprotocol/sdk@1.6.1/client/stdio.js";
import { SSEClientTransport } from "npm:@modelcontextprotocol/sdk@1.6.1/client/sse.js";
import { McpServer } from "../types.ts";
import {
  CreateMessageRequestSchema,
  LoggingMessageNotificationSchema,
  Tool,
} from "npm:@modelcontextprotocol/sdk@1.6.1/types.js";
import { LanguageModelV1 } from "npm:ai@4.1.54";
import { generateText, transformMessages } from "./llm.ts";

export interface McpHubOptions {
  servers: McpServer[];
}

export class McpHub {
  private clients: Array<[Client, McpServer]> = [];
  private servers: McpServer[] = [];

  constructor({ servers }: McpHubOptions) {
    this.servers = servers;
  }

  public async connect({
    model: defaultModel,
    unstableModelPreferences,
    maxRetries,
  }: {
    model: LanguageModelV1;
    unstableModelPreferences: Partial<Record<string, LanguageModelV1>>;
    maxRetries?: number;
  }) {
    for (const server of this.servers) {
      const transport =
        server.type === "stdio"
          ? new StdioClientTransport({
              command: server.command,
              args: server.args,
              env: { ...getDefaultEnvironment(), ...server.env },
            })
          : server.type === "sse"
          ? new SSEClientTransport(new URL(server.url))
          : null;
      if (!transport) {
        throw new Error(`Unsupported transport type: ${server.type}`);
      }

      const client = new Client(
        {
          name: "dewhale",
          version: "1.0.0",
        },
        {
          capabilities: {
            sampling: {},
          },
        }
      );

      client.setNotificationHandler(
        LoggingMessageNotificationSchema,
        ({ params }) => {
          console.log(params.data);
        }
      );

      client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
        const {
          messages,
          maxTokens,
          systemPrompt,
          temperature,
          modelPreferences,
        } = request.params;

        let model = defaultModel;
        const priorities = [
          modelPreferences?.intelligencePriority ?? 0,
          modelPreferences?.costPriority ?? 0,
          modelPreferences?.speedPriority ?? 0,
        ];
        const maxIndex = priorities.indexOf(Math.max(...priorities));
        switch (true) {
          case maxIndex === 0 &&
            unstableModelPreferences.bestIntelligence !== undefined:
            model = unstableModelPreferences.bestIntelligence;
            break;
          case maxIndex === 1 &&
            unstableModelPreferences.bestCost !== undefined:
            model = unstableModelPreferences.bestCost;
            break;
          case maxIndex === 2 &&
            unstableModelPreferences.bestSpeed !== undefined:
            model = unstableModelPreferences.bestSpeed;
            break;
        }

        console.log("[INTERNAL]Sampling Request:", {
          messages,
          systemPrompt,
        });

        //         await this.onSampling([
        //           `[INTERNAL]Sampling Request:
        // \`\`\`json
        // ${JSON.stringify(
        //   {
        //     messages,
        //     systemPrompt,
        //   },
        //   null,
        //   2
        // )}
        // \`\`\`
        // `,
        //         ]);

        const fullMessages = transformMessages(messages);
        if (systemPrompt) {
          fullMessages.unshift({
            role: "system",
            content: systemPrompt,
          });
        }

        const { text } = await generateText({
          messages: fullMessages,
          maxTokens: maxTokens,
          model,
          temperature,
          maxRetries,
        });

        console.log("[INTERNAL]Sampling Result:", text);

        //         await this.onSampling([
        //           `[INTERNAL]Sampling Result:
        // \`\`\`
        // ${text}
        // \`\`\`
        // `,
        //         ]);

        return {
          content: {
            type: "text",
            text,
          },
          model: model.modelId,
          role: "assistant",
        };
      });

      await client.connect(transport);

      this.clients.push([client, server]);
    }
  }

  public async disconnect() {
    await Promise.all(this.clients.map(([client]) => client.close()));
  }

  public async listTools(): Promise<Array<Tool & { client: Client }>> {
    const tools = await Promise.all(
      this.clients.map(async ([client, server]) => {
        const result = await client.listTools();
        return {
          ...result,
          client,
          server,
        };
      })
    );

    return tools.reduce<Array<Tool & { client: Client }>>(
      (acc, { tools, client, server }) => {
        return acc.concat(
          tools
            .filter((t) => {
              if (!server.tools) {
                // allow all
                return true;
              }
              if (server.tools[t.name]) {
                // whitelist
                return true;
              }
              return false;
            })
            .map((t) => ({
              ...t,
              client,
            }))
        );
      },
      []
    );
  }
}
