FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/widget/package.json apps/widget/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile=false --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/widget apps/widget
# Shared's `main: ./dist/index.js` means consumers (vite) can't resolve it
# until it's been compiled. The `prepare` hook would do this, but pnpm
# skipped it (--ignore-scripts). Build shared explicitly first.
RUN pnpm --filter @hzaconnect/shared build
RUN pnpm --filter @hzaconnect/widget build

FROM alpine:3.20 AS output
COPY --from=build /app/apps/widget/dist /out
CMD ["true"]
