import { HttpClient } from "./http.js";
import { AgentsResource } from "./resources/agents.js";
import { AgentsMdResource, ContextResource } from "./resources/context.js";
import { ChecklistsResource } from "./resources/checklists.js";
import { EventsResource } from "./resources/events.js";
import { FilesResource } from "./resources/files.js";
import { NotesResource } from "./resources/notes.js";
import { ProjectsResource } from "./resources/projects.js";
import {
  BootstrapResource,
  HealthResource,
  WorkspacesResource,
} from "./resources/workspaces.js";

export interface VisBoardClientConfig {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export class VisBoardClient {
  readonly workspaces: WorkspacesResource;
  readonly projects: ProjectsResource;
  readonly notes: NotesResource;
  readonly checklists: ChecklistsResource;
  readonly files: FilesResource;
  readonly agents: AgentsResource;
  readonly events: EventsResource;
  readonly context: ContextResource;
  readonly agentsMd: AgentsMdResource;
  readonly bootstrap: BootstrapResource;
  readonly health: HealthResource;

  private readonly http: HttpClient;

  constructor(config: VisBoardClientConfig) {
    this.http = new HttpClient(config);
    this.workspaces = new WorkspacesResource(this.http);
    this.projects = new ProjectsResource(this.http);
    this.notes = new NotesResource(this.http);
    this.checklists = new ChecklistsResource(this.http);
    this.files = new FilesResource(this.http);
    this.agents = new AgentsResource(this.http);
    this.events = new EventsResource(this.http);
    this.context = new ContextResource(this.http);
    this.agentsMd = new AgentsMdResource(this.http);
    this.bootstrap = new BootstrapResource(this.http);
    this.health = new HealthResource(this.http);
  }

  setToken(token: string | undefined): void {
    this.http.setToken(token);
  }
}
