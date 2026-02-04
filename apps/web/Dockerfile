FROM node:20-bullseye-slim AS build
WORKDIR /app
RUN corepack enable
RUN corepack prepare pnpm@9.15.5 --activate

# Install dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

# Build web
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG VITE_API_BASE_URL
ARG VITE_EVENT_ID
ARG VITE_BOOTH_ID
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_EVENT_ID=${VITE_EVENT_ID}
ENV VITE_BOOTH_ID=${VITE_BOOTH_ID}
RUN pnpm --filter @photobot/shared build
RUN pnpm --filter @photobot/web build

# Serve with nginx
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
