# Multi-target image:
#   web     — Next.js standalone server (port 3000)
#   tooling — full source + deps: background worker, migrations, seed
#     docker build --target web -t atlas-web .
#     docker build --target tooling -t atlas-tooling .
# Override BASE_IMAGE to use a registry mirror, e.g.
#   --build-arg BASE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim
ARG BASE_IMAGE=node:22-bookworm-slim

FROM ${BASE_IMAGE} AS base
# Prisma's query engine needs OpenSSL (skipped when the base image already has it).
RUN command -v openssl >/dev/null || (apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*)
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Optional: behind a TLS-intercepting proxy, pass its CA without baking it into the image:
#   docker build --secret id=extra_ca,src=/path/to/ca.crt ...
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# Public branding is baked into the client bundle at build time.
ARG NEXT_PUBLIC_APP_NAME="Atlas Hiring"
ARG NEXT_PUBLIC_APP_TAGLINE=""
ARG NEXT_PUBLIC_BRAND_PRIMARY=""
ARG NEXT_PUBLIC_LEGAL_ENTITY=""
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME NEXT_PUBLIC_APP_TAGLINE=$NEXT_PUBLIC_APP_TAGLINE \
    NEXT_PUBLIC_BRAND_PRIMARY=$NEXT_PUBLIC_BRAND_PRIMARY NEXT_PUBLIC_LEGAL_ENTITY=$NEXT_PUBLIC_LEGAL_ENTITY
# Build needs no secrets; a placeholder URL satisfies Prisma's config parsing.
ENV NEXT_OUTPUT=standalone
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" npm run build

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -r app && useradd -r -g app -u 10001 app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# Local storage is for single-node/dev only; use STORAGE_PROVIDER=s3 in production.
RUN mkdir -p /app/storage && chown app:app /app/storage
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

FROM deps AS tooling
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app -u 10001 app
COPY --chown=app:app . .
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npx prisma generate && mkdir -p /app/storage && chown app:app /app/storage
USER app
EXPOSE 3001
CMD ["npm", "run", "worker"]
