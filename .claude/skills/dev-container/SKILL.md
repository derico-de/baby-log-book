---
name: dev-container
description: Rebuild and restart this repo's dev container (the production image built from the checkout, served on port 5173). Use when the user says "update dev container", "rebuild the dev container", "restart the container", or wants the running container to serve the current code.
---

# Dev container

Rebuilds the shipped image from the current checkout and restarts it. This is
how the running container picks up code changes — nothing hot-reloads in it.

## Rebuild and restart

```bash
docker compose -f compose.yaml -f compose.dev.yaml up --build -d
```

Run it from the repo root. The build takes a couple of minutes (pnpm install +
vite build inside the image), so run it in the background and continue working.

## Verify

```bash
docker ps --format '{{.Image}} {{.Status}}'   # expect: baby-log-book:dev  Up ... (healthy)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5173/health   # expect: 200
```

The container has a healthcheck; give it a few seconds after start before
declaring it healthy.

## What to know

- The image is tagged `baby-log-book:dev` and built with `GIT_SHA: dev` — it
  never wears the published `ghcr.io/derico-de/baby-log-book` tag.
- It binds host port **5173** (container 3000) — the same port `pnpm dev`
  uses, because the sandbox forwards only 5173. Only one of the two can run
  at a time. If the build fails to bind, check whether the Vite dev server is
  running, and ask the user before stopping anything.
- `ORIGIN` comes from `.env` (defaults to `http://localhost:5173`); Claim
  Links are built from it, so it must be the address typed into the browser.
- This serves a production build of the **working tree**, committed or not.
  It is not a development loop — use `pnpm dev` for that (but never start the
  dev server unprompted; expect it running or ask).
