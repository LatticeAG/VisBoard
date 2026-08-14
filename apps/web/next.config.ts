import path from "node:path";
import type { NextConfig } from "next";

function apiConnectOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080/v1";
  try {
    return new URL(configured).origin;
  } catch {
    return "http://localhost:8080";
  }
}

const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@visboard/sdk"],
  async headers() {
    const connect = apiConnectOrigin();
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `connect-src 'self' ${connect}`,
              // Next.js ships an inline RSC bootstrap script, so hydration
              // breaks under script-src 'self' alone. Dev also needs
              // 'unsafe-eval' for the React dev runtime.
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
