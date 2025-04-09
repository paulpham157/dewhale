import "jsr:@std/dotenv@0.225.3/load";
import { createGoogleGenerativeAI } from "npm:@ai-sdk/google@1.1.20";
import { createAnthropic } from "npm:@ai-sdk/anthropic@1.1.17";
import { createOpenAI } from "npm:@ai-sdk/openai@1.2.5";
import {
  generateText,
  streamText,
  tool,
  jsonSchema,
  ToolSet,
  CoreMessage,
} from "npm:ai@4.1.54";
import { PromptMessage } from "npm:@modelcontextprotocol/sdk@1.6.1/types.js";

const google = createGoogleGenerativeAI({
  baseURL: Deno.env.get("GOOGLE_BASE_URL"),
});

const openai = createOpenAI({
  baseURL: Deno.env.get("OPENAI_BASE_URL"),
});

const anthropic = createAnthropic({
  baseURL: Deno.env.get("ANTHROPIC_BASE_URL"),
});

export function getModel(provider: string, model: string) {
  switch (provider) {
    case "google":
      return google(model);
    case "openai":
      return openai(model);
    case "anthropic":
      return anthropic(model);
    default:
      throw new Error(`Invalid provider "${provider}"`);
  }
}

export function transformMessages(messages: PromptMessage[]): CoreMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: [
      {
        type: m.content.type as "text",
        text: m.content.text as string,
      },
    ],
  }));
}

export { generateText, streamText, tool, jsonSchema };
export type { ToolSet };
