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

EXPOSE 3000 3001

CMD ["sh", "-c", "pnpm exec prisma migrate deploy --schema /app/prisma/schema.prisma && pnpm run dev"]
