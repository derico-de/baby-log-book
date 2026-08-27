# 02 — What a custom integration must be in 2026

Type: research
Status: resolved

## Question

The spec has to name Home Assistant's idioms precisely, because the agent building the Python half cannot lean on this repo's conventions — and the charting model's knowledge of HA's requirements is not something to build against unchecked. Against current primary sources (developers.home-assistant.io, the HACS docs, well-regarded cloud-polling integrations as exemplars), establish:

- **Config flow & re-auth**: current `ConfigFlow`/`OptionsFlow` shape, how a re-auth flow is triggered from a 401 and what it may ask, where credentials live in `/config/.storage`.
- **Coordinator**: `DataUpdateCoordinator` for a push-plus-poll source — how an SSE listener and a fallback poll coexist, backoff conventions, what `async_set_updated_data` expects.
- **Entities**: current entity naming rules (`has_entity_name`), device vs entity, `device_class: timestamp` rendering (relative time? localised?), which platforms fit (sensor, binary_sensor, button), how services with arguments are registered and validated.
- **Translations**: how a custom integration ships entity/config-flow strings in en/de/fr.
- **Repair issues**: how an integration raises one (for *hosting is paused* / lapsed) and clears it.
- **HACS**: what a repo must contain to be HACS-installable (manifest keys, `hacs.json`, releases vs default branch), and how a minimum-server-version check is conventionally done.
- **Testing**: the current custom-integration test story (`pytest-homeassistant-custom-component` or successor).
- **Quality scale**: which rungs matter for a custom integration and which exist only for core submission (out of scope here).

Findings to `research/ha-integration-conventions.md`, with primary-source links throughout.

## Answer

Findings at [`research/ha-integration-conventions.md`](../research/ha-integration-conventions.md) — every bullet of the question answered against primary sources (docs-site source markdown, `home-assistant/core` at 2026.8.3, the frontend source, hacs.xyz and the HACS runtime), verified 2026-08-27. What will shape the spec most:

- **Three of ADR-0034's calls are also HA's calls.** Instants-only is what `device_class: timestamp` wants (the frontend renders live, localized relative time; the docs warn against self-ticking duration sensors). SSE-wake + fallback poll is the coordinator's native shape (`DataUpdateCoordinator`, listener in `entry.async_create_background_task`, debounced `async_request_refresh`; Teslemetry and Husqvarna Automower are the citable exemplars). *Lapsed* maps to a non-fixable, idempotent repairs issue plus `ConfigEntryNotReady` retry.
- **Credentials**: there is no credential store for non-OAuth custom integrations — the session cookie sits plaintext in `/config/.storage/core.config_entries`. Config-entry `unique_id` must be the Household/Member id, never the URL. Re-auth = paste a fresh Claim Link with `_abort_if_unique_id_mismatch`; a changed base URL is `async_step_reconfigure`, a separate flow.
- **Translations' one hard rule**: ship `translations/{en,de,fr}.json` directly — `strings.json` + `[%key%]` are core build-time features that *break* custom integrations. Entity names freeze into the registry in the backend language at creation time.
- **The version handshake is code, not manifest** (`manifest.json → requirements` is PyPI-only): Mealie's dual gate — config-flow form error plus `ConfigEntryError` at setup — with `awesomeversion`. Minimum-*HA* gating lives in `hacs.json → homeassistant`, per release.
- **Testing**: `pytest-homeassistant-custom-component` is current (tracks HA weekly, pins 2026.8.3, Python 3.14, `asyncio_mode = auto`) and needs no running HA instance. `ludeeus/integration_blueprint` is still the canonical repo template but ships no tests.
- **Quality scale**: `quality_scale.yaml` is core-only (hassfest skips custom repos — verified in source); treat the scale as a checklist — ~15 rules worth adopting are listed, and `dynamic-devices` is the answer to the entity model's "Baby added later" question.
- **Version floor**: a ledger of since-versions (2024.4→2025.12) closes the doc; 2024.11 is where the current idioms begin, 2025.11 buys the whole set. The exact floor is a spec decision, flagged for [Assemble the spec](10-assemble-the-spec.md).
