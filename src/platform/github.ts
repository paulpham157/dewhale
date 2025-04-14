import { assert } from "jsr:@std/assert@1.0.11";
import { join } from "jsr:@std/path@1.0.8";
import { Octokit } from "npm:octokit@4.1.2";
import commitPlugin from "npm:octokit-commit-multiple-files@5.0.3";
import { PlatformSdk, TriggerEvent } from "../types.ts";
import { IssueEvent, Issue } from "../types.ts";

const PatchedOctokit = Octokit.plugin(commitPlugin);

export class GithubPlatformSdk implements PlatformSdk {
  private octokit: Octokit;

  constructor() {
    const ghToken = Deno.env.get("GITHUB_TOKEN");
    assert(ghToken, "failed to get github token");
    this.octokit = new PatchedOctokit({
      auth: ghToken,
    });
  }

  async getIssueFromEvent(event: IssueEvent) {
    const { owner, repo, id } = event.issue;
    const { data } = await this.octokit.rest.issues.get({
      owner,
      repo,
      issue_number: id,
    });
    const issueComments = (
      await this.octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: id,
      })
    ).data;
    return {
      owner,
      repo,
      id,
      title: data.title,
      content: data.body ?? "",
      state: data.state,
      labels: data.labels.map((l) => {
        if (typeof l === "string") {
          return { name: l };
        }
        return { name: l.name ?? "" };
      }),
      comments: issueComments.map((comment) => ({
        author: {
          name: comment.user?.login ?? "-",
        },
        content: comment.body ?? "",
      })),
    };
  }

  async listIssues({
    owner,
    repo,
    labels,
  }: {
    owner: string;
    repo: string;
    labels?: string[];
  }) {
    const { repository } = await this.octokit.graphql<{
      repository: any;
    }>({
      query: /* GraphQL */ `
        query ($owner: String!, $repo: String!, $labels: [String!]) {
          repository(owner: $owner, name: $repo) {
            issues(labels: $labels, first: 10) {
              nodes {
                number
                title
                body
                state
                labels(first: 10) {
                  nodes {
                    name
                  }
                }
                comments(first: 10) {
                  nodes {
                    author {
                      login
                    }
                    body
                  }
                }
              }
            }
          }
        }
      `,
      owner,
      repo,
      labels,
    });

    return repository.issues.nodes.map((issue: any) => ({
      owner: owner,
      repo: repo,
      id: issue.number,
      title: issue.title,
      content: issue.body,
      state: issue.state,
      labels: issue.labels.nodes.map((l: any) => ({
        name: l.name,
      })),
      comments: issue.comments.nodes.map((comment: any) => ({
        author: {
          name: comment.author.login,
        },
        content: comment.body,
      })),
    }));
  }

  async createIssueComment(issue: Issue, content: string) {
    await this.octokit.rest.issues.createComment({
      owner: issue.owner,
      repo: issue.repo,
      issue_number: issue.id,
      body: content,
    });
  }
}

const __dirname = new URL(".", import.meta.url).pathname;

export function getGithubContext() {
  let WORKSPACE = join(__dirname, "../../");
  if (Deno.env.get("GITHUB_WORKSPACE")) {
    WORKSPACE = Deno.env.get("GITHUB_WORKSPACE")!;
  }
  assert(WORKSPACE, "WORKSPACE is not set");

  let REPO = "";
  let OWNER = "";
  if (Deno.env.get("GITHUB_REPOSITORY")) {
    const [owner, repo] = Deno.env.get("GITHUB_REPOSITORY")!.split("/");
    REPO = repo;
    OWNER = owner;
  }

  let BRANCH = "";
  if (Deno.env.get("BRANCH")) {
    BRANCH = Deno.env.get("BRANCH")!;
  }

  return {
    WORKSPACE,
    REPO,
    OWNER,
    BRANCH,
  };
}

export async function getGithubTriggerEvent(): Promise<TriggerEvent | null> {
  let eventName = "";

  if (Deno.env.get("GITHUB_EVENT_NAME")) {
    eventName = Deno.env.get("GITHUB_EVENT_NAME")!;
  }

  assert(eventName, "failed to get event name");

  // deno-lint-ignore no-explicit-any
  let eventPayload: any = {};

  if (Deno.env.get("GITHUB_EVENT_PATH")) {
    eventPayload = JSON.parse(
      await Deno.readTextFile(Deno.env.get("GITHUB_EVENT_PATH")!)
    );
  }

  if (eventName === "issues" || eventName === "issue_comment") {
    return {
      name: "issues",
      issue: {
        owner: eventPayload.repository.owner.login,
        repo: eventPayload.repository.name,
        id: eventPayload.issue.number,
      },
    };
  }

  if (eventName === "schedule") {
    return {
      name: "schedule",
    };
  }

  console.warn(`Unsupported event: ${eventName}`);

  return null;
}
