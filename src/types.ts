export interface GlobalConfig {
  llm: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    maxRetries?: number;
    maxSteps?: number;
    __unstable_model_preferences?: {
      bestIntelligence?: {
        provider: string;
        model: string;
      };
      bestCost?: {
        provider: string;
        model: string;
      };
      bestSpeed?: {
        provider: string;
        model: string;
      };
    };
  };
  mcp: {
    servers: McpServer[];
  };
  permissions: Permissions;
}

export interface CharacterConfig extends GlobalConfig {
  name: string;
  labels: string[];
  systemPrompt: string;
}

export type McpServer = {
  env?: Record<string, string>;
  tools?: Record<string, unknown>;
} & McpServerTransport;

export type McpServerTransport =
  | {
      type: "stdio";
      command: string;
      args?: string[];
    }
  | {
      type: "sse";
      url: string;
    };

export interface Permissions {
  maxResponsesPerIssue: number;
}

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type TriggerEvent = IssueEvent | ScheduleEvent;

export type IssueEvent = {
  name: "issues";
  issue: {
    owner: string; // github.owner, gitlab.namespace
    repo: string; // github.repo, gitlab.project_id
    id: number; // github.issue.id, gitlab.issue.iid
  };
};

export type ScheduleEvent = {
  name: "schedule";
};

export type PlatformType = "github" | "gitlab";

export interface PlatformSdk {
  getIssueFromEvent(event: IssueEvent): Promise<Issue>;
  listIssues(options: {
    owner: string;
    repo: string;
    labels?: string[];
  }): Promise<Issue[]>;
  createIssueComment(issue: Issue, content: string): Promise<void>;
}

export interface Issue {
  owner: string; // github.owner, gitlab.namespace
  repo: string; // github.repo, gitlab.project_id
  id: number; // github.issue.id, gitlab.issue.iid
  title: string;
  content: string;
  state: string; // github's 'open' state and gitlab's 'opened' state are normalized to 'open'
  labels: { name: string }[];
  comments: IssueComment[];
}

export interface IssueComment {
  author: {
    name: string;
  };
  content: string;
}
