import "jsr:@std/dotenv@0.225.3/load";
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.6.1/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.6.1/server/stdio.js";

import { z } from "npm:zod@3.24.2";
// import { assert } from "jsr:@std/assert@1.0.11";
import {
  ComponentsSchema,
  createNecessityFilter,
  extractComponents,
  readFullComponentDoc,
  readUsageComponentDoc,
} from "./components.ts";
import { parseMessageToJson } from "./parser.ts";
import { CREATE_UI, FILTER_COMPONENTS } from "./system-prompts.ts";
import { refineCode } from "./code-refiner.ts";

const server = new McpServer({
  name: "shadcn",
  version: "1.0.0",
  capabilities: {
    resources: {},
    tools: {},
    logging: {},
  },
});

server.tool(
  "read-usage-doc",
  "read usage doc of a component",
  {
    name: z.string().describe("name of the component, lowercase, kebab-case"),
  },
  async ({ name }) => {
    const doc = await readUsageComponentDoc({ name });
    return {
      content: [
        {
          type: "text",
          text: doc,
        },
      ],
    };
  }
);

server.tool(
  "read-full-doc",
  "read full doc of a component",
  {
    name: z.string().describe("name of the component, lowercase, kebab-case"),
  },
  async ({ name }) => {
    const doc = await readFullComponentDoc({ name });
    return {
      content: [
        {
          type: "text",
          text: doc,
        },
      ],
    };
  }
);

server.tool(
  "create-ui",
  "create Web UI with shadcn/ui components and tailwindcss",
  {
    description: z.string().describe("description of the Web UI"),
  },
  async ({ description }) => {
    const components = await extractComponents();

    const filterComponentsResult = await server.server.createMessage({
      systemPrompt: FILTER_COMPONENTS,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `<description>${description}</description><available-components>${JSON.stringify(
              components
            )}</available-components>`,
          },
        },
      ],
      maxTokens: 2000,
    });

    const filteredComponents = ComponentsSchema.parse(
      parseMessageToJson(filterComponentsResult.content.text as string)
    );
    filteredComponents.components.forEach((c) => {
      c.name = c.name.toLowerCase();
    });
    filteredComponents.charts.forEach((c) => {
      c.name = c.name.toLowerCase();
    });

    // server.server.sendLoggingMessage({
    //   level: "info",
    //   data: `filter ${components.components.length} components to ${filteredComponents.components.length} components`,
    // });

    const usageDocs = await Promise.all(
      filteredComponents.components
        .filter(createNecessityFilter("optional"))
        .map(async (c) => {
          return {
            ...c,
            doc: await readUsageComponentDoc({ name: c.name }),
          };
        })
    );

    const createUiResult = await server.server.createMessage({
      systemPrompt: CREATE_UI,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `<description>${description}</description><available-components>
${usageDocs
  .map((d) => {
    return `<component>
  ### ${d.name}

  > ${d.justification}

  ${d.doc}
  </component>`;
  })
  .join("\n")}
</available-components>`,
          },
        },
      ],
      maxTokens: 32768,
    });

    const uiCode = createUiResult.content.text as string;

    return {
      content: [
        {
          type: "text",
          text: refineCode(uiCode),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("shadcn/UI MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  Deno.exit(1);
});
