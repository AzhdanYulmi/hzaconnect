FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
# better-sqlite3 needs build tools to compile its native binding.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/license-server/package.json apps/license-server/package.json
COPY packages/license/package.json packages/license/package.json
# --ignore-scripts skips workspace prepare hooks (which would fail before
# source is copied) but ALSO skips native-binding compiles. We want the
# native binding for better-sqlite3, so compile it explicitly by invoking
# its package-local "install" script (pnpm 9's `rebuild` won't do it
# without onlyBuiltDependencies whitelisting).
RUN pnpm install --frozen-lockfile=false --ignore-scripts
RUN BSQL_DIR=$(ls -d /app/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3) && \
    cd "$BSQL_DIR" && \
    npm run install && \
    ls -la build/Release/better_sqlite3.node

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/license packages/license
COPY apps/license-server apps/license-server
RUN pnpm --filter @hzaconnect/license build
RUN pnpm --filter @hzaconnect/license-server build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/license ./packages/license
COPY --from=build /app/apps/license-server/package.json ./apps/license-server/package.json
COPY --from=build /app/apps/license-server/node_modules ./apps/license-server/node_modules
COPY --from=build /app/apps/license-server/dist ./apps/license-server/dist
RUN mkdir -p /app/apps/license-server/data /app/apps/license-server/keys
EXPOSE 4400
CMD ["node", "apps/license-server/dist/index.js"]
