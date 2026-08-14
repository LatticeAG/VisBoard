import { HttpClient } from "./http.js";
import type { RequestOptions } from "./http.js";
import { AgentsResource } from "./resources/agents.js";
import { BoardsResource } from "./resources/boards.js";
import { ChecklistsResource } from "./resources/checklists.js";
import { AgentsMdResource, ContextResource } from "./resources/context.js";
import { EventsResource } from "./resources/events.js";
import { FilesResource } from "./resources/files.js";
import { HandoffsResource } from "./resources/handoffs.js";
import { NotesResource } from "./resources/notes.js";
import { ProjectsResource } from "./resources/projects.js";
import { TemplatesResource } from "./resources/templates.js";
import { BootstrapResource, HealthResource, WorkspacesResource } from "./resources/workspaces.js";

export interface VisBoardClientConfig {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export class VisBoardClient {
  readonly workspaces: WorkspacesResource;
  readonly projects: ProjectsResource;
  /** V2 canonical board API. Configure this client with a `/v2` base URL. */
  readonly boards: BoardsResource;
  readonly templates: TemplatesResource;
  readonly notes: NotesResource;
  readonly checklists: ChecklistsResource;
  readonly files: FilesResource;
  readonly agents: AgentsResource;
  readonly events: EventsResource;
  readonly context: ContextResource;
  readonly agentsMd: AgentsMdResource;
  readonly bootstrap: BootstrapResource;
  readonly health: HealthResource;
  readonly handoffs: HandoffsResource;

  private readonly http: HttpClient;

  constructor(config: VisBoardClientConfig) {
    this.http = new HttpClient(config);
    this.workspaces = new WorkspacesResource(this.http);
    this.projects = new ProjectsResource(this.http);
    this.boards = new BoardsResource(this.http);
    this.templates = new TemplatesResource(this.http);
    this.notes = new NotesResource(this.http);
    this.checklists = new ChecklistsResource(this.http);
    this.files = new FilesResource(this.http);
    this.agents = new AgentsResource(this.http);
    this.events = new EventsResource(this.http);
    this.context = new ContextResource(this.http);
    this.agentsMd = new AgentsMdResource(this.http);
    this.bootstrap = new BootstrapResource(this.http);
    this.health = new HealthResource(this.http);
    this.handoffs = new HandoffsResource(this.http);
  }

  setToken(token: string | undefined): void {
    this.http.setToken(token);
  }

  get baseUrl(): string {
    return this.http.baseUrl;
  }

  /**
   * Low-level escape hatch for versioned extensions that have not yet grown a
   * first-class resource. Public adapters, such as @visboard/agent-sdk, use
   * this so they retain the SDK's auth, error, and request serialization.
   */
  request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.http.request<T>(path, options);
  }
}
