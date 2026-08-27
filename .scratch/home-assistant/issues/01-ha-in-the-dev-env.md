# 01 — A Home Assistant in the dev env

Type: task
Status: resolved

## Question

Stand up a **Home Assistant core container** in the local environment, beside the app's own dev setup, so the entity model can be *looked at* rather than imagined — nine entities per Baby on a dashboard, whether `device_class: timestamp` really renders *in 40 Minuten* in German, what a config flow feels like to walk through.

Maintainer-requested during charting. What "done" records:

- How it runs (compose service beside `compose.dev.yaml`? its own file?), which image/tag, where its `/config` volume lives — and that none of it leaks into the production compose.
- How it reaches the app: the app's dev server and the HA container must see each other (the sandbox forwards only 5173 — see the live-mode memory — so the answer probably involves the containers sharing a network rather than `localhost`).
- The URL and how to open it, for every later HITL session that wants to show something on it.
- Explicitly *not* CI: whether this joins CI is fog, not this ticket.

## Answer

Standing, and it showed what it was stood up to show: a `device_class: timestamp` tile renders **„In 39 Minuten"** — live, localized, relative — for a German user on a stock tile card ([screenshot](../assets/01-ha-timestamp-tile.png), [first login](../assets/01-ha-first-look.png)).

**How it runs.** Home Assistant core **2026.8.3** (pinned) via [`compose.ha.yaml`](../../../compose.ha.yaml) at the repo root — its own self-contained file, own service, own volume; it is never passed together with `compose.yaml`/`compose.dev.yaml`, so nothing leaks into what self-hosters pull. `/config` is a bind mount at [`ha/config/`](../../../ha/README.md); only `configuration.yaml` (+ empty include files) is versioned — German locale, Europe/Berlin, metric, and the throwaway smoke-test template sensor. Everything else HA writes there (auth, recorder db, logs) is gitignored, and the root `.gitignore`'s `*.db` already covers the recorder.

    docker compose -f compose.ha.yaml up -d

**How it reaches the app.** Not a shared compose network — simpler: `extra_hosts: host.docker.internal:host-gateway`, so from inside the container the app is **`http://host.docker.internal:5173`** whichever of `pnpm dev` or the dev container owns the port (verified 200 from `/health` against the running dev container). One URL for the later config flow, no coupling between the compose projects.

**The URL and how to open it.** The UI publishes sandbox-local **`http://localhost:8123`** — enough for agent-driven browser sessions (Chromium is now apt-installed system-wide; seed `localStorage.hassTokens` over CDP to skip the login form). The sandbox forwards only 5173, so for a *human* the port has to be borrowed: stop whatever owns 5173 (ask first), then `HA_PORT=5173 docker compose -f compose.ha.yaml up -d` and open http://powerman:5173; swap back after. If a second forwarded port is ever available, `HA_PORT` is the only knob. Login: `dev` / `babylog-dev`, onboarding completed headlessly via `/api/onboarding` (user language `de`, so relative timestamps speak German).

**Facts later tickets lean on.**
- The frontend's relative-time rendering ticks client-side with no traffic — the instants-only wire contract suspected in [The wire contract](09-the-wire-contract.md) is what the tile card natively wants.
- The entity name ("Smoke test due instant") is whatever the backend hands over — the translations fog item is real, the dashboard won't translate names for free.
- HA 2026.x renamed dashboard WS commands (`lovelace/dashboards/create`, not the older `config/lovelace/dashboards/create`) — small proof that conventions drift and the research ticket's verify-against-current stance is warranted. A `smoke-test` dashboard with the one tile exists on the volume.
- Explicitly **not CI** — whether it ever joins CI stays fog on the map (and the conventions research suggests the Python half tests without a live instance anyway).
