FROM node:20-bullseye-slim AS base
WORKDIR /app
RUN corepack enable
RUN corepack prepare pnpm@9.15.5 --activate
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

# Build
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/worker apps/worker
RUN pnpm -C packages/db prisma generate
RUN pnpm --filter @photobot/shared build
RUN pnpm --filter @photobot/db build
RUN pnpm --filter @photobot/worker build

# Runtime
FROM node:20-bullseye-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
  && rm -rf /var/lib/apt/lists/*
# Copy full app to preserve pnpm workspace node_modules links
COPY --from=base /app /app
CMD ["node", "apps/worker/dist/index.js"]
