# Baby Log Book — one image, published for strangers. Spec §4.4.
#
# Multi-arch linux/amd64 + linux/arm64, because self-hosters run ARM NASes and
# Pis. Nothing in here compiles: better-sqlite3 13.x ships eight prebuilt
# Node-API addons in its tarball, including linuxmusl-x64 and linuxmusl-arm64,
# which is why `--ignore-scripts` is safe and why Alpine is safe.
#
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     --build-arg GIT_SHA=$(git rev-parse --short HEAD) -t baby-log-book:1 .

# Pinned to the builder's own architecture: this stage only runs pnpm and vite,
# and its output — plain JS plus better-sqlite3's eight prebuilt addons — is
# identical on every platform. Emulating it for arm64 would cost minutes and
# change nothing.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app

# Corepack pins pnpm to the "packageManager" field in package.json, so the image
# and a developer's machine resolve the same pnpm without a version repeated
# here to drift.
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
# Baked in and shown in the UI beside a source link, which is how AGPL §13 is
# satisfied for every operator automatically rather than every self-hoster being
# non-compliant by default.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
RUN pnpm run build && pnpm prune --prod --ignore-scripts


FROM node:24-alpine
WORKDIR /app

ENV NODE_ENV=production
# One HTTP port on the internal network. No host port is published here, no TLS,
# no proxy config: nginx, Caddy and Traefik are equally supported and none is
# configured by us.
ENV PORT=3000
ENV DATA_DIR=/data
ENV BODY_SIZE_LIMIT=2M

# The container runs as a non-root uid owning /data. "DB inside the container"
# means one process and one image — not state in the container layer, which dies
# on every update.
RUN addgroup -S app && adduser -S -G app -h /app app \
	&& mkdir -p /data && chown -R app:app /data

COPY --from=build --chown=app:app /app/build ./build
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --chown=app:app bin ./bin

# The operator's second entrypoint: `docker exec <container> babylog members`.
RUN chmod +x /app/bin/babylog.js && ln -s /app/bin/babylog.js /usr/local/bin/babylog

USER app
VOLUME ["/data"]
EXPOSE 3000

# Opens the DB and runs one trivial query, nothing more — never "did the last
# sync succeed", which would restart-loop the container because a *client*
# misbehaved. The start period is generous so boot migrations do not count as
# failure.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ORIGIN is required and this will refuse to boot without it: a Claim Link is an
# absolute URL sent over WhatsApp, so a wrong origin mints dead invites silently.
CMD ["node", "build/index.js"]
