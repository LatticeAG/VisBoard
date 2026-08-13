CREATE TABLE "boards" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"legacy_project_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_document_id" text,
	"head_revision_id" text,
	"head_sequence" integer DEFAULT 0 NOT NULL,
	"effect_generation" integer DEFAULT 0 NOT NULL,
	"template_installation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "board_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_from_revision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"document_id" text NOT NULL,
	"type" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"parent_block_id" text,
	"slot" text,
	"rank" text DEFAULT 'a0' NOT NULL,
	"visibility" text DEFAULT 'board' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"template_origin_key" text,
	"created_by_type" text NOT NULL,
	"created_by_id" text NOT NULL,
	"updated_by_type" text NOT NULL,
	"updated_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "board_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"document_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"parent_revision_id" text,
	"restored_from_revision_id" text,
	"trigger" text NOT NULL,
	"label" text,
	"summary" text,
	"state" jsonb NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_events" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"revision_id" text,
	"type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"causation_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scope" text DEFAULT 'private' NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"manifest" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"template_version_id" text NOT NULL,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'installed' NOT NULL,
	"installed_by_id" text NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_block_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"template_node_key" text NOT NULL,
	"block_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_legacy_project_id_projects_id_fk" FOREIGN KEY ("legacy_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "board_documents" ADD CONSTRAINT "board_documents_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "board_blocks" ADD CONSTRAINT "board_blocks_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "board_blocks" ADD CONSTRAINT "board_blocks_document_id_board_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."board_documents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "board_revisions" ADD CONSTRAINT "board_revisions_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "board_revisions" ADD CONSTRAINT "board_revisions_document_id_board_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."board_documents"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "board_events" ADD CONSTRAINT "board_events_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "board_templates" ADD CONSTRAINT "board_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_board_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."board_templates"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "template_installations" ADD CONSTRAINT "template_installations_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "template_installations" ADD CONSTRAINT "template_installations_template_version_id_template_versions_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_versions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "template_block_mappings" ADD CONSTRAINT "template_block_mappings_installation_id_template_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."template_installations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "template_block_mappings" ADD CONSTRAINT "template_block_mappings_block_id_board_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."board_blocks"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "boards_workspace_id_idx" ON "boards" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "boards_workspace_id_slug_active_unique" ON "boards" USING btree ("workspace_id", "slug") WHERE "boards"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "boards_legacy_project_id_unique" ON "boards" USING btree ("legacy_project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "board_documents_board_id_epoch_unique" ON "board_documents" USING btree ("board_id", "epoch");
--> statement-breakpoint
CREATE INDEX "board_documents_board_id_state_idx" ON "board_documents" USING btree ("board_id", "state");
--> statement-breakpoint
CREATE INDEX "board_blocks_board_id_idx" ON "board_blocks" USING btree ("board_id");
--> statement-breakpoint
CREATE INDEX "board_blocks_document_id_idx" ON "board_blocks" USING btree ("document_id");
--> statement-breakpoint
CREATE INDEX "board_blocks_parent_block_id_idx" ON "board_blocks" USING btree ("parent_block_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "board_blocks_board_template_origin_key_active_unique" ON "board_blocks" USING btree ("board_id", "template_origin_key") WHERE "board_blocks"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "board_revisions_board_id_revision_number_unique" ON "board_revisions" USING btree ("board_id", "revision_number");
--> statement-breakpoint
CREATE INDEX "board_revisions_board_id_created_at_idx" ON "board_revisions" USING btree ("board_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "board_events_board_id_sequence_unique" ON "board_events" USING btree ("board_id", "sequence");
--> statement-breakpoint
CREATE INDEX "board_events_board_id_created_at_idx" ON "board_events" USING btree ("board_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "board_templates_workspace_id_slug_unique" ON "board_templates" USING btree ("workspace_id", "slug");
--> statement-breakpoint
CREATE INDEX "board_templates_scope_idx" ON "board_templates" USING btree ("scope");
--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_template_id_version_unique" ON "template_versions" USING btree ("template_id", "version");
--> statement-breakpoint
CREATE INDEX "template_installations_board_id_idx" ON "template_installations" USING btree ("board_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "template_block_mappings_installation_node_key_unique" ON "template_block_mappings" USING btree ("installation_id", "template_node_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "template_block_mappings_installation_block_id_unique" ON "template_block_mappings" USING btree ("installation_id", "block_id");
