CREATE TABLE "agent_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"profile" text NOT NULL,
	"state" text NOT NULL,
	"source" text,
	"branch" text,
	"root_label" text NOT NULL,
	"latest_snapshot_id" text,
	"latest_snapshot" jsonb,
	"quota_bytes" integer,
	"scratchpad_content" text DEFAULT '' NOT NULL,
	"scratchpad_version" integer DEFAULT 1 NOT NULL,
	"scratchpad_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_workspaces_state_check" CHECK ("state" IN ('provisioning','ready','suspended','destroyed')),
	CONSTRAINT "agent_workspaces_profile_check" CHECK ("profile" IN ('external','container','git_worktree','remote_runner'))
);
--> statement-breakpoint
CREATE TABLE "agent_workspace_files" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"path" text NOT NULL,
	"content" text NOT NULL,
	"encoding" text DEFAULT 'utf-8' NOT NULL,
	"version" integer NOT NULL,
	"sha256" text NOT NULL,
	"generated" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"agent_workspace_id" text,
	"mode" text NOT NULL,
	"state" text NOT NULL,
	"goal" text NOT NULL,
	"base_revision_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"summary" text,
	CONSTRAINT "agent_runs_mode_check" CHECK ("mode" IN ('observe','propose','contribute','operate')),
	CONSTRAINT "agent_runs_state_check" CHECK ("state" IN ('running','waiting_for_human','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "agent_leases" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"allowed_paths" text[] DEFAULT '{}' NOT NULL,
	"state" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_leases_state_check" CHECK ("state" IN ('active','revoked','expired'))
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"originating_run_id" text NOT NULL,
	"agent_workspace_id" text,
	"revision_id" text,
	"state" text NOT NULL,
	"packet" jsonb NOT NULL,
	"packet_hash" text,
	"belief_trace_hash" text,
	"claimed_by_id" text,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"resumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "handoffs_state_check" CHECK ("state" IN ('draft','awaiting_review','in_review','approved','rejected','changes_requested','cancelled','expired','resumed'))
);
--> statement-breakpoint
CREATE TABLE "handoff_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"handoff_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"outcome" text NOT NULL,
	"rationale" text,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"packet_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_workspaces" ADD CONSTRAINT "agent_workspaces_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_workspaces" ADD CONSTRAINT "agent_workspaces_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_workspace_files" ADD CONSTRAINT "agent_workspace_files_workspace_id_agent_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."agent_workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_leases" ADD CONSTRAINT "agent_leases_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "handoff_decisions" ADD CONSTRAINT "handoff_decisions_handoff_id_handoffs_id_fk" FOREIGN KEY ("handoff_id") REFERENCES "public"."handoffs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_workspace_files_workspace_id_path_unique" ON "agent_workspace_files" ("workspace_id","path");
--> statement-breakpoint
CREATE INDEX "agent_runs_board_id_idx" ON "agent_runs" ("board_id");
--> statement-breakpoint
CREATE INDEX "agent_leases_run_id_idx" ON "agent_leases" ("run_id");
--> statement-breakpoint
CREATE INDEX "handoffs_board_id_state_idx" ON "handoffs" ("board_id","state");
--> statement-breakpoint
CREATE INDEX "handoff_decisions_handoff_id_idx" ON "handoff_decisions" ("handoff_id");
