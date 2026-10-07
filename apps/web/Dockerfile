FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/web --include-workspace-root --ignore-scripts

FROM deps AS build
ARG NEXT_PUBLIC_JITSI_DOMAIN=localhost:8443
ARG NEXT_PUBLIC_BROWSER_CAPTIONS=false
# next.config.mjs resolves the API proxy target (rewrites) when the config loads, and Next.js
# bakes rewrites into .next/routes-manifest.json at build time — so this must be set here, not
# just as a container runtime env var, or the standalone server proxies to the build-time default.
ARG API_INTERNAL_URL=http://api:4000
ENV NEXT_PUBLIC_JITSI_DOMAIN=$NEXT_PUBLIC_JITSI_DOMAIN NEXT_PUBLIC_BROWSER_CAPTIONS=$NEXT_PUBLIC_BROWSER_CAPTIONS NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=$API_INTERNAL_URL
COPY apps/web apps/web
RUN npm run build -w apps/web

FROM node:22-alpine
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S evida && adduser -S evida -G evida
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER evida
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]
