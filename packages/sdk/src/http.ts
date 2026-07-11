import { VisBoardError } from "./error.js";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  token?: string | null;
  expectJson?: boolean;
}

export interface HttpClientConfig {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export class HttpClient {
  readonly baseUrl: string;
  private token?: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.fetchFn = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  setToken(token: string | undefined): void {
    this.token = token;
  }

  buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(
      path.startsWith("http") ? path : `${this.baseUrl}${path.startsWith("/") ? "" : "/"}${path}`,
    );
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const {
      method = "GET",
      body,
      headers = {},
      query,
      token = this.token,
      expectJson = true,
    } = options;

    const requestHeaders: Record<string, string> = { ...headers };
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
    }

    let requestBody: BodyInit | undefined;
    if (body !== undefined) {
      if (body instanceof FormData || body instanceof Blob || typeof body === "string") {
        requestBody = body as BodyInit;
      } else {
        requestHeaders["Content-Type"] = "application/json";
        requestBody = JSON.stringify(body);
      }
    }

    const response = await this.fetchFn(this.buildUrl(path, query), {
      method,
      headers: requestHeaders,
      body: requestBody,
    });

    if (!response.ok) {
      throw await VisBoardError.fromResponse(response);
    }

    if (response.status === 204 || !expectJson) {
      return response as unknown as T;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as T;
    }

    return (await response.text()) as unknown as T;
  }

  async requestRaw(path: string, options: RequestOptions = {}): Promise<Response> {
    const {
      method = "GET",
      body,
      headers = {},
      query,
      token = this.token,
    } = options;

    const requestHeaders: Record<string, string> = { ...headers };
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
    }

    let requestBody: BodyInit | undefined;
    if (body !== undefined) {
      if (body instanceof FormData || body instanceof Blob || typeof body === "string") {
        requestBody = body as BodyInit;
      } else {
        requestHeaders["Content-Type"] = "application/json";
        requestBody = JSON.stringify(body);
      }
    }

    const response = await this.fetchFn(this.buildUrl(path, query), {
      method,
      headers: requestHeaders,
      body: requestBody,
    });

    if (!response.ok) {
      throw await VisBoardError.fromResponse(response);
    }

    return response;
  }
}
