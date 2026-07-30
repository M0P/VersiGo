FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json ./
COPY apps/ apps/
COPY packages/ packages/
COPY prisma/ prisma/

RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:24-alpine AS runner
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

COPY --from=base /app /app
COPY docker/start.sh /app/start.sh

RUN chmod +x /app/start.sh

EXPOSE 3000 3001

CMD ["/app/start.sh"]
