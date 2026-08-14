CREATE TABLE "automation_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"board_id" text,
	"version" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"event_id" text NOT NULL,
	"state" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"effect_generation" integer DEFAULT 0 NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_runs_state_check" CHECK ("state" IN ('pending','running','awaiting_approval','succeeded','failed','blocked','skipped'))
);
--> statement-breakpoint
CREATE TABLE "automation_action_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"action_id" text NOT NULL,
	"state" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	CONSTRAINT "automation_action_runs_state_check" CHECK ("state" IN ('pending','running','awaiting_approval','succeeded','failed','blocked','skipped'))
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"secret_ciphertext" text DEFAULT '' NOT NULL,
	"secret_iv" text DEFAULT '' NOT NULL,
	"secret_tag" text DEFAULT '' NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_status_check" CHECK ("status" IN ('active','paused','disabled','invalid'))
);
--> statement-breakpoint
CREATE TABLE "sync_links" (
	"id" text PRIMARY KEY NOT NULL,
	"connection_id" text NOT NULL,
	"board_id" text NOT NULL,
	"local_resource_id" text NOT NULL,
	"external_id" text NOT NULL,
	"direction" text NOT NULL,
	"field_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text NOT NULL,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "sync_links_direction_check" CHECK ("direction" IN ('inbound','outbound','bidirectional')),
	CONSTRAINT "sync_links_state_check" CHECK ("state" IN ('active','paused','conflicted','disabled'))
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_conflicts_state_check" CHECK ("state" IN ('open','resolved','dismissed'))
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"status" text NOT NULL,
	"storage_path" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "export_jobs_status_check" CHECK ("status" IN ('pending','ready','failed'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "automation_action_runs" ADD CONSTRAINT "automation_action_runs_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_links" ADD CONSTRAINT "sync_links_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_links" ADD CONSTRAINT "sync_links_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_link_id_sync_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."sync_links"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "automation_rules_workspace_id_idx" ON "automation_rules" ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_dedupe_key_unique" ON "automation_runs" ("dedupe_key");
--> statement-breakpoint
CREATE INDEX "automation_runs_rule_id_idx" ON "automation_runs" ("rule_id");
--> statement-breakpoint
CREATE INDEX "automation_action_runs_run_id_idx" ON "automation_action_runs" ("run_id");
--> statement-breakpoint
CREATE INDEX "integration_connections_workspace_id_idx" ON "integration_connections" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "sync_links_connection_id_idx" ON "sync_links" ("connection_id");
--> statement-breakpoint
CREATE INDEX "sync_links_board_id_idx" ON "sync_links" ("board_id");
--> statement-breakpoint
CREATE INDEX "sync_conflicts_link_id_idx" ON "sync_conflicts" ("link_id");
--> statement-breakpoint
CREATE INDEX "export_jobs_workspace_id_idx" ON "export_jobs" ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_workspace_id_key_unique" ON "idempotency_records" ("workspace_id","key");
