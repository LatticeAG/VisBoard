FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/agents-md/package.json packages/agents-md/
COPY packages/sdk/package.json packages/sdk/
COPY packages/agent-sdk/package.json packages/agent-sdk/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/agents-md packages/agents-md
COPY packages/sdk packages/sdk
COPY packages/agent-sdk packages/agent-sdk
COPY apps/api apps/api
RUN pnpm --filter @visboard/api... build

FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/agents-md/package.json packages/agents-md/
COPY packages/sdk/package.json packages/sdk/
COPY packages/agent-sdk/package.json packages/agent-sdk/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp/package.json packages/mcp/
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/agents-md/dist packages/agents-md/dist
COPY --from=builder /app/packages/sdk/dist packages/sdk/dist
COPY --from=builder /app/packages/agent-sdk/dist packages/agent-sdk/dist
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY packages/db/src/migrations packages/db/src/migrations
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "apps/api/dist/index.js"]
