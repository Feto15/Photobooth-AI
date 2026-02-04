FROM node:20-bullseye-slim AS base
WORKDIR /app
RUN corepack enable
RUN corepack prepare pnpm@9.15.5 --activate

# Build stage
FROM base AS builder
# Install basic build tools just for generic native modules (like bcrypt if any)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json

# Install dependencies (Jimp is pure JS, no native build needed)
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/worker apps/worker

# Generate Prisma client
RUN pnpm -C packages/db prisma generate

# Build packages
RUN pnpm --filter @photobot/shared build
RUN pnpm --filter @photobot/db build
RUN pnpm --filter @photobot/worker build

# Runtime stage
FROM node:20-bullseye-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install openssl for Prisma
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Copy build result
COPY --from=builder /app /app

CMD ["node", "apps/worker/dist/index.js"]
