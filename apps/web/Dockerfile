FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/db/package.json ./packages/db/
COPY packages/agents-md/package.json ./packages/agents-md/
COPY packages/agent-sdk/package.json ./packages/agent-sdk/
COPY packages/cli/package.json ./packages/cli/
COPY packages/mcp/package.json ./packages/mcp/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter @visboard/sdk... build
RUN pnpm --filter @visboard/web build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
