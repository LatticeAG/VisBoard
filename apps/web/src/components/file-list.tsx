"use client";

import { api } from "@/lib/api-client";
import type { FileRecord } from "@visboard/sdk";
import { useState } from "react";

interface FileListProps {
  files: FileRecord[];
  ws: string;
  project: string;
}

export function FileList({ files, ws, project }: FileListProps) {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownload = async (file: FileRecord) => {
    setDownloadingId(file.id);
    setDownloadError(null);

    const result = await api.files.download(ws, project, file.id);
    if (!result.ok) {
      setDownloadError(result.error);
      setDownloadingId(null);
      return;
    }

    try {
      const blob = await result.data.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("Failed to download file");
    }

    setDownloadingId(null);
  };

  if (files.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-sm text-muted">
        No files uploaded
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-mono text-sm text-text">Files</h2>
        <p className="font-mono text-xs text-muted">{files.length} file(s)</p>
        {downloadError && <p className="mt-1 font-mono text-xs text-red-400">{downloadError}</p>}
      </div>

      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted">
            <th className="px-4 py-2 font-normal">Name</th>
            <th className="px-4 py-2 font-normal">Type</th>
            <th className="px-4 py-2 font-normal">Size</th>
            <th className="px-4 py-2 font-normal" />
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={file.id} className="border-b border-border hover:bg-bg">
              <td className="px-4 py-2 text-text">{file.name}</td>
              <td className="px-4 py-2 text-muted">{file.mime_type}</td>
              <td className="px-4 py-2 text-muted">{formatBytes(file.size_bytes)}</td>
              <td className="px-4 py-2">
                <button
                  type="button"
                  onClick={() => handleDownload(file)}
                  disabled={downloadingId === file.id}
                  className="text-accent hover:underline disabled:opacity-50"
                  title={`Download ${file.name}`}
                >
                  {downloadingId === file.id ? "…" : "↓"}
                </button>
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
