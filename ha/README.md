# Home Assistant dev instance

A Home Assistant core container for developing the Home Assistant integration
— so entity models, dashboards and config flows can be looked at instead of
imagined. Dev tooling only; it has no connection to the production compose
files and is deliberately not part of CI.

## Run

```bash
docker compose -f compose.ha.yaml up -d
```

The UI is at `http://localhost:8123` **inside the sandbox** (enough for
agent-driven browser sessions via the Chromium/CDP setup). The sandbox
forwards only port 5173, so for a human to see the UI, stop whatever owns
5173 (`pnpm dev` or the dev container — ask before stopping anything) and
republish on it:

```bash
HA_PORT=5173 docker compose -f compose.ha.yaml up -d
```

Then open http://powerman:5173. Swap back afterwards: `docker compose -f
compose.ha.yaml down`, restart what owned the port.

## Login

Onboarding is already done on this volume; the dev user is `dev` /
`babylog-dev`, frontend language German (so `device_class: timestamp`
renders as *in 40 Minuten*). On a fresh clone `/config` starts empty of
state, HA re-runs onboarding in the browser — pick any local credentials
and update this line.

## Reaching the app

From inside the HA container the app is `http://host.docker.internal:5173`,
regardless of whether `pnpm dev` or the dev container is serving it.

## What is versioned

Only `ha/config/configuration.yaml` (plus the empty include files): German
locale, Europe/Berlin, metric, and one throwaway `device_class: timestamp`
template sensor as a smoke test. Everything else HA writes under
`ha/config/` is runtime state and gitignored.
