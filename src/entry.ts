import { Character, loadAllCharacters } from "./character.ts";
import {
  getPlatformSdk,
  getTriggerEvent,
  WORKSPACE,
  REPO,
  OWNER,
} from "./platform/index.ts";
import { Issue } from "./types.ts";

console.log("hello v2");

const data: Record<string, string> = {};
for (const [key, value] of Object.entries(Deno.env.toObject())) {
  data[`env_${key}`] = value;
}

const characters = await loadAllCharacters(WORKSPACE, data);

const event = await getTriggerEvent();

const sdk = getPlatformSdk();

switch (event?.name) {
  case "issues": {
    const issue = await sdk.getIssueFromEvent(event);

    await letCharacterDoTask(characters, issue);
    break;
  }
  case "schedule": {
    const issues = await sdk.listIssues({
      owner: OWNER,
      repo: REPO,
      labels: ["schedule"],
    });
    for (const issue of issues) {
      await letCharacterDoTask(characters, issue);
    }
    break;
  }
  default:
    console.warn(`Unsupported event`);
}

async function letCharacterDoTask(characters: Character[], issue: Issue) {
  if (issue.state.toLowerCase() !== "open") {
    return;
  }

  for (const character of characters) {
    if (!character.matchesLabels(issue.labels)) {
      continue;
    }

    // TODO: parallel
    await character.initialize();

    await character.doTask(issue);

    await character.finalize();
  }
}
