"use client";

import { useCallback, useEffect, useState } from "react";

export type ToastVariant = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

let nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = ++nextId;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), 4000);
      return id;
    },
    [dismiss],
  );

  return { toasts, show, dismiss };
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const variantClass =
    toast.variant === "success"
      ? "border-success text-success"
      : toast.variant === "error"
        ? "border-red-800 text-red-400"
        : "border-accent-dim text-accent";

  return (
    <output
      className={`pointer-events-auto flex items-center gap-3 border bg-surface px-4 py-2 font-mono text-xs shadow-lg ${variantClass}`}
    >
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="text-muted hover:text-text"
        aria-label="Dismiss"
      >
        ×
      </button>
    </output>
  );
}

interface InlineAlertProps {
  message: string;
  variant?: ToastVariant;
  className?: string;
}

export function InlineAlert({ message, variant = "error", className = "" }: InlineAlertProps) {
  const variantClass =
    variant === "success"
      ? "border-success text-success"
      : variant === "info"
        ? "border-accent-dim text-accent"
        : "border-red-900 text-red-400";

  return (
    <div
      className={`border bg-surface px-4 py-3 font-mono text-xs ${variantClass} ${className}`}
      role="alert"
    >
      {message}
    </div>
  );
}
