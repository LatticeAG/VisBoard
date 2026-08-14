import type { HttpClient } from "../http.js";
import type { FileRecord } from "../types.js";

export interface UploadFileInput {
  file: Blob;
  filename: string;
}

export class FilesResource {
  constructor(private readonly http: HttpClient) {}

  upload(ws: string, project: string, input: UploadFileInput): Promise<FileRecord> {
    const form = new FormData();
    form.append("file", input.file, input.filename);
    return this.http.request<FileRecord>(`/workspaces/${ws}/projects/${project}/files`, {
      method: "POST",
      body: form,
    });
  }

  list(ws: string, project: string): Promise<FileRecord[]> {
    return this.http.requestList<FileRecord>(`/workspaces/${ws}/projects/${project}/files`);
  }

  get(ws: string, project: string, fileId: string): Promise<FileRecord> {
    return this.http.request<FileRecord>(`/workspaces/${ws}/projects/${project}/files/${fileId}`);
  }

  download(ws: string, project: string, fileId: string): Promise<Response> {
    return this.http.requestRaw(`/workspaces/${ws}/projects/${project}/files/${fileId}`, {
      query: { download: 1 },
    });
  }

  delete(ws: string, project: string, fileId: string): Promise<void> {
    return this.http.request<void>(`/workspaces/${ws}/projects/${project}/files/${fileId}`, {
      method: "DELETE",
    });
  }
}
