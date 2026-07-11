import { createPrefixedId } from "@visboard/shared";
import { createDbFromEnv } from "./client";
import { workspaces } from "./schema/workspaces";

async function seed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const { db, client } = createDbFromEnv(databaseUrl);

  const existing = await db.select().from(workspaces).limit(1);
  if (existing.length > 0) {
    console.log("Seed skipped: workspaces already exist");
    await client.end();
    return;
  }

  const workspaceId = createPrefixedId("workspace");

  await db.insert(workspaces).values({
    id: workspaceId,
    slug: "demo",
    name: "Demo Workspace",
  });

  console.log(`Seeded workspace: demo (${workspaceId})`);
  await client.end();
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
