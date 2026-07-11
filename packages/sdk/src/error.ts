export interface ProblemDetails {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

export class VisBoardError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly type?: string;
  readonly instance?: string;
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "VisBoardError";
    this.status = problem.status;
    this.title = problem.title;
    this.detail = problem.detail;
    this.type = problem.type;
    this.instance = problem.instance;
    this.problem = problem;
  }

  static async fromResponse(response: Response): Promise<VisBoardError> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/problem+json")) {
      const problem = (await response.json()) as ProblemDetails;
      return new VisBoardError({
        ...problem,
        status: problem.status ?? response.status,
        title: problem.title ?? response.statusText,
      });
    }

    let detail: string | undefined;
    try {
      const text = await response.text();
      detail = text || undefined;
    } catch {
      detail = undefined;
    }

    return new VisBoardError({
      status: response.status,
      title: response.statusText || "Request failed",
      detail,
    });
  }
}
