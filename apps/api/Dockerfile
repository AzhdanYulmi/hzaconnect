FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/license/package.json packages/license/package.json
RUN pnpm install --frozen-lockfile=false --ignore-scripts

FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/license packages/license
COPY apps/api apps/api
RUN pnpm --filter @hzaconnect/shared build
RUN pnpm --filter @hzaconnect/license build
RUN pnpm --filter @hzaconnect/api build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/license ./packages/license
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/src/db/migrations ./apps/api/dist/db/migrations
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
