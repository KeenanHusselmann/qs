# The container PLATFORM.md §13.1 chose.
#
# > "Runs as a plain Node server in a container, not serverless."
# > "Single container. One long-running Node process. Headless Chrome and background jobs need no
# >  special handling, and there are no cold starts to fight against the <5s PDF budget."
#
# Serverless was the deviation, and every constraint that came with it — twelve functions, a 60s
# ceiling on the agent route, a 4.5MB body limit the upload path had to be built around — is a tax
# this image stops paying.
#
# ── Migrations run at start, not at build ─────────────────────────────────────────────────────
#
# `npm run build` migrates first, which is right for a platform that builds against the database it
# is about to serve, and wrong here twice over: a `docker build` has no database to reach, and
# baking a migration into an image means the image cannot be built without write access to
# production. HANDOFF records what that cost on Vercel — the obvious local command would have
# migrated the instance production serves.
#
# So the image runs `next build` alone, and the entrypoint migrates the database it is actually
# pointed at, once, at start. Same script, same output, and it names the host it reached.

# ── deps ──────────────────────────────────────────────────────────────────────────────────────
# The full install, including devDependencies: `next build` needs typescript and tailwind, and the
# runner needs `dotenv`, which migrate.mjs imports and which is a devDependency.
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci

# ── builder ───────────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY . .

# `output: "standalone"` is set only under this flag — Vercel builds its own output and breaks if
# given it (next.config.ts). `postbuild.mjs` is gated on the same flag and copies static assets in,
# without which the server returns 200 and 404s every stylesheet.
ENV BUILD_TARGET=container
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build && node scripts/postbuild.mjs

# ── runner ────────────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Documents are written here, and **this has to be a mounted volume**. A container filesystem does
# not survive a redeploy, and `storage.ts` records what that looked like the last time it happened:
# every document filed was "parsed, indexed, and its original thrown away, silently, for weeks".
ENV STORAGE_DIR=/data

COPY --from=builder --chown=node:node /build/.next/standalone ./
COPY --from=builder --chown=node:node /build/.next/static ./.next/static
COPY --from=builder --chown=node:node /build/public ./public

# What the entrypoint needs. `root` in migrate.mjs is the parent of its own directory, so `scripts/`
# and `drizzle/` have to stay siblings at /app or it will not find the migrations.
COPY --from=builder --chown=node:node /build/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=node:node /build/drizzle ./drizzle

# Next traces only the files the *application* imports, so `drizzle-orm/postgres-js/migrator` and
# `dotenv` are absent from the standalone bundle — nothing in the app imports either. Copied whole
# rather than patched into migrate.mjs, so the script that runs here is the same one that runs on a
# developer's machine, unmodified.
COPY --from=deps --chown=node:node /build/node_modules/dotenv ./node_modules/dotenv
COPY --from=deps --chown=node:node /build/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps --chown=node:node /build/node_modules/postgres ./node_modules/postgres

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

# `/api/health` sits in front of the session gate on purpose — every page redirects to /login before
# touching the database, so an authenticated probe could never tell "database down" from "not signed
# in". That is exactly the distinction a health check exists to make.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `exec` so the server replaces the shell and becomes PID 1 — otherwise SIGTERM stops at `sh` and
# the platform kills a process that was never asked to stop.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
