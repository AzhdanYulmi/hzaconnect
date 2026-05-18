# Edge image: Caddy with dashboard + widget static files baked in.
# Built by CI on tag; customers pull from GHCR. Replaces nginx + dashboard-build
# + widget-build from the legacy compose stack.

# --- Build dashboard + widget ---
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY apps/widget/package.json apps/widget/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile=false --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/dashboard apps/dashboard
COPY apps/widget apps/widget
RUN pnpm --filter @hzaconnect/shared build \
 && pnpm --filter @hzaconnect/dashboard build \
 && pnpm --filter @hzaconnect/widget build

# --- Runtime: Caddy serving the built assets ---
# Layout under /srv:
#   /srv/dashboard/        Vite SPA (index.html + assets/)
#   /srv/widget.js         widget loader (top-level for casino embed)
#   /srv/widget/           widget iframe entry + assets (frame.html, *.js, *.css)
FROM caddy:2.8-alpine
RUN mkdir -p /srv/widget /srv/dashboard
COPY --from=frontend /app/apps/dashboard/dist/ /srv/dashboard/
COPY --from=frontend /app/apps/widget/dist/widget.js /srv/widget.js
COPY --from=frontend /app/apps/widget/dist/frame.html /srv/widget/frame.html
COPY --from=frontend /app/apps/widget/dist/widget/ /srv/widget/
COPY deploy/install/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443
