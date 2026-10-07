# EVIDA API + worker image (same image, different command).
# Prisma 7 uses the Rust-free query compiler, so no native engine binaries are downloaded or shipped.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --include-workspace-root --ignore-scripts

FROM deps AS build
COPY apps/api apps/api
WORKDIR /app/apps/api
RUN PRISMA_SCHEMA_ENGINE_BINARY=/bin/false npx prisma generate && npx tsc -p tsconfig.build.json

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --include-workspace-root --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
RUN apk add --no-cache tini && addgroup -S evida && adduser -S evida -G evida
WORKDIR /app/apps/api
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma/migrations ./prisma/migrations
COPY --from=build /app/apps/api/scripts ./scripts
COPY apps/api/package.json ./
USER evida
EXPOSE 4000 4100
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health/live || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# Migrations run as a separate one-off step (compose "migrate" service / k8s Job), never on every API start.
CMD ["node", "dist/main.js"]
