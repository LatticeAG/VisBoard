import { createPrefixedId } from "@visboard/shared";
import { createDbFromEnv } from "./client.js";
import { notes, projects, users, workspaceMembers, workspaces } from "./schema/index.js";

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
    console.log(
      "Tip: use `visboard auth bootstrap` for a fresh admin PAT instead of seeding tokens.",
    );
    await client.end();
    return;
  }

  const now = new Date();
  const workspaceId = createPrefixedId("workspace");
  const userId = createPrefixedId("user");
  const projectId = createPrefixedId("project");
  const noteId = createPrefixedId("note");

  await db.insert(workspaces).values({
    id: workspaceId,
    slug: "demo",
    name: "Demo Workspace",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(users).values({
    id: userId,
    displayName: "Demo User",
    email: "demo@visboard.local",
    createdAt: now,
  });

  await db.insert(workspaceMembers).values({
    workspaceId,
    userId,
    role: "owner",
    createdAt: now,
  });

  await db.insert(projects).values({
    id: projectId,
    workspaceId,
    slug: "demo",
    name: "Demo Project",
    description: "Sample project for local development",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(notes).values({
    id: noteId,
    projectId,
    slug: "purpose",
    title: "Purpose",
    body: "# Purpose\n\nShip VisBoard.",
    frontmatter: {},
    isSystem: false,
    version: 1,
    createdByType: "user",
    createdById: userId,
    updatedByType: "user",
    updatedById: userId,
    createdAt: now,
    updatedAt: now,
  });

  console.log("Seeded demo workspace:");
  console.log(`  workspace: demo (${workspaceId})`);
  console.log(`  user: Demo User (${userId})`);
  console.log(`  project: demo (${projectId})`);
  console.log(`  note: purpose (${noteId})`);
  console.log(
    "No PAT created: run `visboard auth bootstrap` (preferred) or create a token via the API.",
  );

  await client.end();
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
