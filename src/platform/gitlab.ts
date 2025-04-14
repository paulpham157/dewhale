import { assert } from "jsr:@std/assert@1.0.11";
import { join } from "jsr:@std/path@1.0.8";
import { Gitlab } from "npm:@gitbeaker/rest@42.2.0";
import * as core from "npm:@gitbeaker/core@42.2.0";
import { Issue, PlatformSdk, TriggerEvent } from "../types.ts";
import { IssueEvent } from "../types.ts";

function getLabelName(l: core.IssueSchema["labels"][0]) {
  if (typeof l === "string") {
    return l;
  }
  return l.name;
}

export class GitlabPlatformSdk implements PlatformSdk {
  private gitlab: core.Gitlab;

  constructor() {
    const glToken = Deno.env.get("GITLAB_TOKEN");
    if (!glToken) {
      throw new Error("failed to get gitlab token");
    }
    const glHost = Deno.env.get("GITLAB_HOST") ?? "https://gitlab.com";

    this.gitlab = new Gitlab({
      token: glToken,
      host: glHost,
    });
  }

  async getIssueFromEvent(event: IssueEvent) {
    const { repo: projectId, id } = event.issue;
    const issue = await this.gitlab.Issues.show(id, {
      projectId,
    });

    const project = await this.gitlab.Projects.show(projectId);

    const state = issue.state === "opened" ? "open" : issue.state;
    const issueComments = await this.gitlab.IssueNotes.all(projectId, id, {
      sort: "asc",
      orderBy: "created_at",
    });

    return {
      owner: project.namespace.name,
      repo: projectId,
      id,
      title: issue.title,
      content: issue.description ?? "",
      state,
      labels: issue.labels.map((l) => ({ name: getLabelName(l) })),
      comments: issueComments
        .filter((c) => !c.system)
        .map((comment) => ({
          author: {
            name: comment.author.name ?? "-",
          },
          content: comment.body ?? "",
        })),
    };
  }

  async listIssues(options: {
    owner: string;
    repo: string;
    labels?: string[];
  }): Promise<Issue[]> {
    const { repo: projectId, labels } = options;
    const issueList = await this.gitlab.Issues.all({
      projectId,
      labels: labels?.join(","),
    });

    const project = await this.gitlab.Projects.show(projectId);

    const issues: Issue[] = [];

    for (const issue of issueList) {
      const state = issue.state === "opened" ? "open" : issue.state;
      const issueComments = await this.gitlab.IssueNotes.all(
        projectId,
        issue.iid,
        {
          sort: "asc",
          orderBy: "created_at",
        }
      );

      issues.push({
        owner: project.namespace.name,
        repo: projectId,
        id: issue.iid,
        title: issue.title,
        content: issue.description ?? "",
        state,
        labels: issue.labels.map((l) => ({ name: l })),
        comments: issueComments
          .filter((c) => !c.system)
          .map((comment) => ({
            author: {
              name: comment.author.name ?? "-",
            },
            content: comment.body ?? "",
          })),
      });
    }

    return issues;
  }

  async createIssueComment(issue: Issue, content: string): Promise<void> {
    await this.gitlab.IssueNotes.create(issue.repo, issue.id, content);
  }
}

const __dirname = new URL(".", import.meta.url).pathname;

export function getGitLabContext() {
  let WORKSPACE = join(__dirname, "../../");
  if (Deno.env.get("CI_PROJECT_DIR")) {
    WORKSPACE = Deno.env.get("CI_PROJECT_DIR")!;
  }
  assert(WORKSPACE, "WORKSPACE is not set");

  let REPO = "";
  let OWNER = "";
  if (Deno.env.get("CI_PROJECT_NAMESPACE") && Deno.env.get("CI_PROJECT_ID")) {
    OWNER = Deno.env.get("CI_PROJECT_NAMESPACE")!;
    REPO = Deno.env.get("CI_PROJECT_ID")!;
  }

  let BRANCH = "";
  if (Deno.env.get("CI_COMMIT_REF_NAME")) {
    BRANCH = Deno.env.get("CI_COMMIT_REF_NAME")!;
  }

  return {
    WORKSPACE,
    REPO,
    OWNER,
    BRANCH,
  };
}

export async function getGitlabTriggerEvent(): Promise<TriggerEvent | null> {
  // deno-lint-ignore no-explicit-any
  let eventPayload:
    | core.WebhookIssueEventSchema
    | core.WebhookIssueNoteEventSchema
    | null = null;

  if (Deno.env.get("CI_EVENT_PATH")) {
    eventPayload = JSON.parse(
      await Deno.readTextFile(Deno.env.get("CI_EVENT_PATH")!)
    );
  }

  if (
    eventPayload?.event_type === "issue" ||
    eventPayload?.event_type === "note"
  ) {
    return {
      name: "issues",
      issue: {
        owner: eventPayload.project.namespace,
        repo: eventPayload.project.id.toString(),
        id:
          eventPayload.event_type === "issue"
            ? eventPayload.object_attributes.iid
            : eventPayload.issue.iid,
      },
    };
  }

  return null;
}
