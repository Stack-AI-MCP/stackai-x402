FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.json ./
COPY apps/moltbook/package.json apps/moltbook/
RUN pnpm install --frozen-lockfile --filter=moltbook
COPY apps/moltbook/tsconfig.json apps/moltbook/
COPY apps/moltbook/src/ apps/moltbook/src/
RUN pnpm --filter=moltbook build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable pnpm
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/moltbook/package.json apps/moltbook/
RUN pnpm install --frozen-lockfile --filter=moltbook --prod
COPY --from=builder /app/apps/moltbook/dist apps/moltbook/dist/

WORKDIR /app/apps/moltbook
ENV PORT=3003
EXPOSE 3003
CMD ["node", "--env-file", ".env", "dist/index.js"]
