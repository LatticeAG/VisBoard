CREATE UNIQUE INDEX "personal_access_tokens_token_hash_unique" ON "personal_access_tokens" ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "agents_token_hash_unique" ON "agents" ("token_hash");
--> statement-breakpoint
UPDATE "personal_access_tokens" SET "revoked_at" = now() WHERE "revoked_at" IS NULL;
--> statement-breakpoint
UPDATE "agents" SET "revoked_at" = now() WHERE "revoked_at" IS NULL;
