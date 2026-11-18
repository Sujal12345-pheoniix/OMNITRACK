# syntax=docker/dockerfile:1.7
# One build, several runnable targets (api, worker, web, portal, migrate).
# The same image digest is promoted between environments; only configuration differs.

FROM node:20.18.0-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo

# ── Build everything once ─────────────────────────────────────────────
FROM base AS build
COPY . .
RUN npm ci --no-audit --no-fund
# Next.js bakes rewrite destinations at build time.
ARG API_INTERNAL_URL=http://api:4100
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN npx turbo run build --filter=@omnitrack/api --filter=@omnitrack/worker --filter=@omnitrack/web --filter=@omnitrack/portal

# ── Runtime images: non-root, read-only application files ───────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=root:root /repo /repo
USER node

FROM runtime AS api
EXPOSE 4100
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD node -e "fetch('http://127.0.0.1:4100/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

FROM runtime AS worker
EXPOSE 4200
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD node -e "fetch('http://127.0.0.1:4200/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/worker/dist/main.js"]

FROM runtime AS web
EXPOSE 3100
WORKDIR /repo/apps/web
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "--port", "3100", "--hostname", "0.0.0.0"]

FROM runtime AS portal
EXPOSE 3200
WORKDIR /repo/apps/portal
CMD ["node", "../../node_modules/next/dist/bin/next", "start", "--port", "3200", "--hostname", "0.0.0.0"]

# One-shot job: applies pending migrations with the migrator role, then exits.
FROM runtime AS migrate
WORKDIR /repo/packages/db
CMD ["node", "../../node_modules/prisma/build/index.js", "migrate", "deploy"]
