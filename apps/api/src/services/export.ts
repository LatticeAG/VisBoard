import { projects, workspaces, type Database } from "@visboard/db";

interface ExportJob {
  id: string;
  workspaceId: string;
  status: "pending" | "ready" | "failed";
  data?: Uint8Array;
  createdAt: Date;
}

const exportJobs = new Map<string, ExportJob>();

export async function startExport(
  db: Database["db"],
  workspaceId: string,
): Promise<{ export_id: string; status: "pending" }> {
  const exportId = `exp_${Date.now()}`;
  const job: ExportJob = {
    id: exportId,
    workspaceId,
    status: "pending",
    createdAt: new Date(),
  };
  exportJobs.set(exportId, job);

  processExport(db, job).catch(() => {
    job.status = "failed";
  });

  return { export_id: exportId, status: "pending" };
}

async function processExport(db: Database["db"], job: ExportJob) {
  const { eq } = await import("drizzle-orm");

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, job.workspaceId))
    .limit(1);

  const projectRows = await db
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, job.workspaceId));

  const exportData = {
    workspace,
    projects: projectRows,
    exported_at: new Date().toISOString(),
  };

  const json = JSON.stringify(exportData, null, 2);
  job.data = new TextEncoder().encode(json);
  job.status = "ready";
}

export function getExport(
  workspaceId: string,
  exportId: string,
): ExportJob | null {
  const job = exportJobs.get(exportId);
  if (!job || job.workspaceId !== workspaceId) return null;
  return job;
}

export function clearExportsForTests(): void {
  exportJobs.clear();
}
