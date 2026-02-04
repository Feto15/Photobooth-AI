FROM node:20-bullseye-slim AS base
WORKDIR /app
RUN corepack enable

# Install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

# Build
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm -C packages/db prisma generate
RUN pnpm --filter @photobot/shared build
RUN pnpm --filter @photobot/db build
RUN pnpm --filter @photobot/api build

# Runtime
FROM node:20-bullseye-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/apps/api/dist apps/api/dist
COPY --from=base /app/apps/api/package.json apps/api/package.json
COPY --from=base /app/node_modules node_modules
COPY --from=base /app/packages/db/prisma packages/db/prisma
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]
