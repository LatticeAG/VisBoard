FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/agents-md/package.json packages/agents-md/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile || pnpm install
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/agents-md packages/agents-md
COPY apps/api apps/api
RUN pnpm --filter @visboard/api build

FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/agents-md/package.json packages/agents-md/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod || pnpm install --prod
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/db/dist packages/db/dist
COPY --from=builder /app/packages/agents-md/dist packages/agents-md/dist
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY packages/shared/src packages/shared/src
COPY packages/db/src packages/db/src
COPY packages/agents-md/src packages/agents-md/src
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "apps/api/dist/index.js"]
