import { VisBoardError } from "@visboard/sdk";

export function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

export function errorResult(error: unknown) {
  if (error instanceof VisBoardError) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              title: error.title,
              status: error.status,
              detail: error.detail ?? error.message,
            },
            null,
            2,
          ),
        },
      ],
      isError: true as const,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}
