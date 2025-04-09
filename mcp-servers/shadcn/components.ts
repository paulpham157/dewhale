import { fromMarkdown } from "https://esm.sh/mdast-util-from-markdown@2.0.0";
import { visitParents } from "https://esm.sh/unist-util-visit-parents@6.0.1";
import { z } from "npm:zod@3.24.2";

const BASE_URL = `https://raw.githubusercontent.com/shadcn-ui/ui/refs/heads/main/apps/www`;

function kebab(str: string) {
  return str
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function extractConfig(fileContent: string) {
  try {
    // Find and extract the configuration object
    const configMatch = fileContent.match(
      /export const docsConfig: DocsConfig = ({[\s\S]*})/
    );

    if (!configMatch) {
      throw new Error("Could not find docsConfig in the file");
    }

    // Create a safe evaluation context
    const configObject = eval(`(${configMatch[1]})`);
    return configObject;
  } catch (error) {
    console.error("Error extracting config:", error);
    return null;
  }
}

export async function extractComponents() {
  const fileContent = await fetch(`${BASE_URL}/config/docs.ts`).then((res) =>
    res.text()
  );

  // Extract the configuration
  const config = extractConfig(fileContent);

  if (!config) {
    return {
      components: [],
      charts: [],
    };
  }

  // Extract components from sidebarNav
  const componentsSection = config.sidebarNav.find(
    (section: { title: string }) => section.title === "Components"
  );
  const components: string[] = componentsSection
    ? componentsSection.items.map((item: { title: string }) =>
        kebab(item.title)
      )
    : [];

  // Extract charts from chartsNav
  const chartsSection = config.chartsNav.find(
    (section: { title: string }) => section.title === "Charts"
  );
  const charts: string[] = chartsSection
    ? chartsSection.items.map((item: { title: string }) => kebab(item.title))
    : [];

  return { components, charts: [] };
}

function extractTsxCodeBlocks(markdownContent: string): string[] {
  // Parse the markdown into an AST
  const ast = fromMarkdown(markdownContent);

  // Find the heading node for "Usage"
  let usageHeadingNode = null;
  let usageSectionStart = -1;
  let usageSectionEnd = Infinity;

  // Find the Usage heading and its position
  visitParents(ast, "heading", (node, ancestors) => {
    if (
      node.depth === 2 &&
      node.children &&
      node.children[0] &&
      node.children[0].type === "text" &&
      node.children[0].value === "Usage"
    ) {
      usageHeadingNode = node;
      usageSectionStart = node.position?.end?.line || -1;
    }
  });

  // If no Usage section, return empty array
  if (usageSectionStart === -1) {
    console.log("No Usage section found in the markdown");
    return [];
  }

  // Find the next heading after Usage to determine the end of the section
  visitParents(ast, "heading", (node) => {
    const headingLine = node.position?.start?.line || Infinity;
    if (
      node.depth === 2 &&
      headingLine > usageSectionStart &&
      headingLine < usageSectionEnd
    ) {
      usageSectionEnd = headingLine;
    }
  });

  // Extract code blocks with tsx language
  const tsxBlocks: string[] = [];
  visitParents(ast, "code", (node) => {
    const nodeLine = node.position?.start?.line || 0;

    // Check if the code block is within the Usage section and is tsx
    if (
      nodeLine > usageSectionStart &&
      nodeLine < usageSectionEnd &&
      node.lang === "tsx"
    ) {
      tsxBlocks.push(node.value);
    }
  });

  return tsxBlocks;
}

export function readFullComponentDoc({ name }: { name: string }) {
  return fetch(`${BASE_URL}/content/docs/components/${name}.mdx`).then((res) =>
    res.text()
  );
}

export async function readUsageComponentDoc({ name }: { name: string }) {
  const fileContent = await readFullComponentDoc({ name });

  const usageBlocks = extractTsxCodeBlocks(fileContent);

  return `\`\`\`\`tsx
${usageBlocks.join("\n")}
\`\`\`\``;
}

export const ComponentSchema = z.object({
  name: z.string(),
  necessity: z.enum(["critical", "important", "optional"]),
  justification: z.string(),
});

export const ComponentsSchema = z.object({
  components: z.array(ComponentSchema),
  charts: z.array(ComponentSchema),
});

export function createNecessityFilter(necessity: string) {
  return (component: { necessity: string }) => {
    const score: Record<string, number> = {
      critical: 3,
      important: 2,
      optional: 1,
    };
    return (score[component.necessity] ?? 0) >= (score[necessity] ?? 0);
  };
}
