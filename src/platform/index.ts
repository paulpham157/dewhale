import { PlatformSdk, PlatformType, TriggerEvent } from "../types.ts";
import {
  GithubPlatformSdk,
  getGithubContext,
  getGithubTriggerEvent,
} from "./github.ts";
import {
  getGitLabContext,
  getGitlabTriggerEvent,
  GitlabPlatformSdk,
} from "./gitlab.ts";

const PLATFORM_TYPE = (Deno.env.get("PLATFORM_TYPE") ??
  "github") as PlatformType;

const { WORKSPACE, BRANCH, OWNER, REPO } =
  PLATFORM_TYPE === "github"
    ? getGithubContext()
    : PLATFORM_TYPE === "gitlab"
    ? getGitLabContext()
    : {
        WORKSPACE: "",
        BRANCH: "",
        OWNER: "",
        REPO: "",
      };

export { WORKSPACE, BRANCH, OWNER, REPO };

export function getTriggerEvent(): Promise<TriggerEvent | null> {
  switch (PLATFORM_TYPE) {
    case "github":
      return getGithubTriggerEvent();
    case "gitlab":
      return getGitlabTriggerEvent();
    default:
      throw new Error(`Invalid platform type "${PLATFORM_TYPE}"`);
  }
}

export function getPlatformSdk(): PlatformSdk {
  switch (PLATFORM_TYPE) {
    case "github":
      return new GithubPlatformSdk();
    case "gitlab":
      return new GitlabPlatformSdk();
    default:
      throw new Error(`Invalid platform type "${PLATFORM_TYPE}"`);
  }
}
