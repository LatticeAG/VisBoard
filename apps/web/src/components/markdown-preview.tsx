"use client";

import ReactMarkdown from "react-markdown";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className = "" }: MarkdownPreviewProps) {
  return (
    <div
      className={`prose prose-invert max-w-none overflow-y-auto p-4 font-sans text-sm text-text ${className}`}
    >
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-0 border-b border-border pb-2 font-mono text-lg text-text">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-4 font-mono text-base text-accent">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 mt-3 font-mono text-sm text-text">{children}</h3>
          ),
          p: ({ children }) => <p className="mb-2 leading-relaxed text-text">{children}</p>,
          code: ({ children, className: codeClass }) => {
            const isBlock = codeClass?.includes("language-");
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded border border-border bg-bg p-3 font-mono text-xs text-text">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-bg px-1 font-mono text-xs text-accent">{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded border border-border bg-bg p-0">
              {children}
            </pre>
          ),
          ul: ({ children }) => <ul className="mb-2 list-disc pl-5 text-text">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 text-text">{children}</ol>,
          li: ({ children }) => <li className="mb-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent pl-3 text-muted">{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} className="text-accent hover:underline">
              {children}
            </a>
          ),
        }}
      >
        {content || "*Empty note*"}
      </ReactMarkdown>
    </div>
  );
}
