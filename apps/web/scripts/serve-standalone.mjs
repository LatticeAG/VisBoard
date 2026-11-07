import { spawn } from "node:child_process";
// Serve the production build from Next's standalone output.
//
// `next start` refuses to work with `output: "standalone"` (it prints a warning
// and is not supported). Next's guidance is to run the emitted server directly,
// after copying the static assets into the standalone tree, which is what this
// script does. Used by Playwright's webServer and available for local prod runs.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneRoot = path.join(webRoot, ".next", "standalone");
const appRoot = path.join(standaloneRoot, "apps", "web");
const serverJs = path.join(appRoot, "server.js");

if (!existsSync(serverJs)) {
  console.error(
    `[serve-standalone] ${serverJs} not found. Run "next build" with output: "standalone" first.`,
  );
  process.exit(1);
}

// Static assets are not copied into the standalone bundle by Next.
const staticSrc = path.join(webRoot, ".next", "static");
if (existsSync(staticSrc)) {
  cpSync(staticSrc, path.join(appRoot, ".next", "static"), { recursive: true });
}
const publicSrc = path.join(webRoot, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, path.join(appRoot, "public"), { recursive: true });
}

const port = process.env.PORT ?? "3001";
const hostname = process.env.HOSTNAME ?? "127.0.0.1";

const child = spawn(process.execPath, [serverJs], {
  stdio: "inherit",
  env: { ...process.env, PORT: port, HOSTNAME: hostname, NODE_ENV: "production" },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
