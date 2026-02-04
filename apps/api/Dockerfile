FROM node:20-bullseye-slim AS base
WORKDIR /app
RUN corepack enable
RUN corepack prepare pnpm@9.15.5 --activate

# Build stage
FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json

# Install dependencies (linked correctly by pnpm)
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api

# Generate Prisma client
RUN pnpm -C packages/db prisma generate

# Build packages
RUN pnpm --filter @photobot/shared build
RUN pnpm --filter @photobot/db build
RUN pnpm --filter @photobot/api build

# Runtime stage
FROM node:20-bullseye-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install openssl for Prisma
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Copy built files and node_modules from builder
COPY --from=builder /app /app

EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
