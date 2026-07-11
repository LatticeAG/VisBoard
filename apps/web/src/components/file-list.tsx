'use client';

import type { FileRecord } from '@visboard/sdk';

interface FileListProps {
  files: FileRecord[];
  ws: string;
  project: string;
}

export function FileList({ files, ws, project }: FileListProps) {
  if (files.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-sm text-muted">
        No files uploaded
      </div>
    );
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/v1';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-mono text-sm text-text">Files</h2>
        <p className="font-mono text-xs text-muted">{files.length} file(s)</p>
      </div>

      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="px-4 py-2 font-normal">Name</th>
            <th className="px-4 py-2 font-normal">Type</th>
            <th className="px-4 py-2 font-normal">Size</th>
            <th className="px-4 py-2 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.id} className="border-b border-border hover:bg-bg">
              <td className="px-4 py-2 text-text">{file.name}</td>
              <td className="px-4 py-2 text-muted">{file.mime_type}</td>
              <td className="px-4 py-2 text-muted">{formatBytes(file.size_bytes)}</td>
              <td className="px-4 py-2">
                <a
                  href={`${apiUrl}/workspaces/${ws}/projects/${project}/files/${file.id}?download=1`}
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ↓
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
