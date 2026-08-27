# Home Assistant custom-integration conventions (verified 2026-08-27)

Verified against primary sources on 2026-08-27. Current stable Home Assistant Core is
**2026.8** (released 2026-08-05; [release post](https://www.home-assistant.io/blog/2026/08/05/release-20268/));
**2026.9** is in beta ([beta post](https://rc.home-assistant.io/blog/2026/08/26/release-20269/)).
Developer-docs claims below were verified against the `master` branch of
[home-assistant/developers.home-assistant](https://github.com/home-assistant/developers.home-assistant)
(the source of developers.home-assistant.io), core source against the `dev` branch of
[home-assistant/core](https://github.com/home-assistant/core), HACS docs against
[hacs/documentation](https://github.com/hacs/documentation). Raw-file URLs are given
because they are what was actually read; the rendered pages live under
`https://developers.home-assistant.io/docs/...` with the same path minus `.md`.

> **Docs restructure note:** the config-flow developer docs moved. The old pages
> `docs/config_entries_config_flow_handler.md` / `docs/config_entries_options_flow_handler.md`
> are gone (404 on master); the current sources are
> `docs/core/integration/config_flow.md` and `docs/core/integration/options_flow.md`.

---

## 1. Config flow & re-auth

Source: [docs/core/integration/config_flow.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/core/integration/config_flow.md),
[docs/core/integration/options_flow.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/core/integration/options_flow.md),
[docs/integration_setup_failures.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/integration_setup_failures.md).

### ConfigFlow shape

```python
from homeassistant import config_entries

class ExampleConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Example config flow."""
    VERSION = 1        # both default to 1 if not set
    MINOR_VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            ...  # validate, then return self.async_create_entry(title=..., data=...)
        return self.async_show_form(
            step_id="user", data_schema=vol.Schema({vol.Required("password"): str})
        )
```

- `manifest.json` must set `"config_flow": true` (manifest doc, section 6 below).
- Return type of steps is `ConfigFlowResult` (the old `FlowResult` name: `.result` attribute
  was removed per blog [2025-07-31-result-removed-from-flowresult](https://github.com/home-assistant/developers.home-assistant/blob/master/blog/2025-07-31-result-removed-from-flowresult.md)).
- Unique IDs: `await self.async_set_unique_id(device_id)` then
  `self._abort_if_unique_id_configured()`. "The unique ID does not need to be globally
  unique, it only needs to be unique within an integration domain."
  `self._abort_if_unique_id_mismatch()` is for reauth/reconfigure (ensures the account the
  user just logged into is the same one the entry represents).
- `_abort_if_unique_id_configured()` accepts `reload_on_update=False` to suppress its
  reload side effect (blog [2026-05-07](https://github.com/home-assistant/developers.home-assistant/blob/master/blog/2026-05-07-config-entry-listener-together-with-reloading-methods.md)).

### OptionsFlow (current shape, post-2024.11)

```python
from homeassistant.config_entries import OptionsFlow  # or OptionsFlowWithReload

@staticmethod
@callback
def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlowHandler:
    """Create the options flow."""
    return OptionsFlowHandler()          # NOTE: no config_entry argument passed

class OptionsFlowHandler(OptionsFlow):
    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        return self.async_show_form(
            step_id="init",
            data_schema=self.add_suggested_values_to_schema(
                OPTIONS_SCHEMA, self.config_entry.options
            ),
        )
```

- First step is always `async_step_init`. The entry is available as the automatically
  provided `self.config_entry` property (also `self._config_entry_id`).
- **Deprecated** (blog [2024-11-12-options-flow](https://github.com/home-assistant/developers.home-assistant/blob/master/blog/2024-11-12-options-flow.md)):
  `OptionsFlowWithConfigEntry` ("kept for backward compatibility only … should be avoided
  in new code") and manually setting `self.config_entry` in `__init__` (deprecation window
  ran "until Home Assistant Core 2025.12").
- **`OptionsFlowWithReload`** (available since ~2025.8; used by core integrations in that
  release — [2025.8 changelog](https://www.home-assistant.io/changelogs/core-2025.8/)):
  subclass it instead of `OptionsFlow` and the integration "will automatically reload the
  integration once the options change" — this replaces the update-listener pattern.
- Update-listener pattern (still valid, but do **not** combine with reloading flow
  classes): in `async_setup_entry` do
  `entry.async_on_unload(entry.add_update_listener(update_listener))` with
  `async def update_listener(hass: HomeAssistant, entry: ConfigEntry): ...`.
  Since **2026.6** combining a config-entry update listener with reloading methods in a
  config flow is deprecated ("can cause the integration to reload twice and/or create a
  race condition") and becomes an **error in 2026.12**; alternatives: drop the listener,
  use `async_update_and_abort()` instead of `async_update_reload_and_abort()`, or pass
  `reload_on_update=False`
  ([blog 2026-05-07](https://github.com/home-assistant/developers.home-assistant/blob/master/blog/2026-05-07-config-entry-listener-together-with-reloading-methods.md)).
- Advanced-mode gating (`FlowHandler.show_advanced_options` and the
  `show_advanced_options` context key) is deprecated, removal in **2027.6**; group extra
  options in a form *section* instead
  ([blog 2026-05-26](https://github.com/home-assistant/developers.home-assistant/blob/master/blog/2026-05-26-advanced-mode-config-flow-deprecation.md)).

### Re-auth from a 401

Source: [docs/integration_setup_failures.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/integration_setup_failures.md).

- Raise `homeassistant.exceptions.ConfigEntryAuthFailed` "from `async_setup_entry` in
  `__init__.py` or from the `DataUpdateCoordinator`" (raising it inside the coordinator's
  `_async_update_data` "will cancel future updates and start a config flow with
  `SOURCE_REAUTH`"). "Home Assistant will automatically put the config entry in a failure
  state and start a reauth flow."
- Companion exceptions: `ConfigEntryNotReady` (transient failure — "Home Assistant will
  automatically take care of retrying set up later", logs at debug level, message shown on
  the integrations page; `await coordinator.async_config_entry_first_refresh()` raises it
  automatically if the first refresh fails).
- The reauth flow the integration must implement (verbatim from config_flow.md):

```python
async def async_step_reauth(
    self, entry_data: Mapping[str, Any]
) -> ConfigFlowResult:
    """Perform reauth upon an API authentication error."""
    return await self.async_step_reauth_confirm()

async def async_step_reauth_confirm(
    self, user_input: dict[str, Any] | None = None
) -> ConfigFlowResult:
    """Dialog that informs the user that reauth is required."""
    if user_input is None:
        return self.async_show_form(
            step_id="reauth_confirm", data_schema=vol.Schema({}),
        )
    return await self.async_step_user()
```

  The reauth form may ask for whatever credential material is needed (password, token) —
  typically it re-collects the secret and, on success, updates the existing entry rather
  than creating a new one:

```python
if self.source == SOURCE_REAUTH:
    self._abort_if_unique_id_mismatch()
    return self.async_update_reload_and_abort(
        self._get_reauth_entry(),
        data_updates=data,          # merged into existing entry.data, not replacing it
    )
```

- Helpers `self._get_reauth_entry()` / `self._get_reconfigure_entry()` are "preferred over
  `self.hass.config_entries.async_get_entry(self.context['entry_id'])`"; `data_updates`
  "merge[s] the data updates with the pre-existing data". Introduced late 2024
  ([blog 2024-10-21-reauth-reconfigure-helpers](https://github.com/home-assistant/developers.home-assistant/blob/master/blog/2024-10-21-reauth-reconfigure-helpers.md)).
  When steps are shared between flow sources, branch on
  `self.source == SOURCE_REAUTH` / `SOURCE_RECONFIGURE`.
- The strings for the flow need `config.step.reauth_confirm` plus the standard abort keys
  (`reauth_successful`; for reconfigure flows "a new message `reconfigure_successful` must
  be present in `strings.json`" — same 2024-10-21 blog).
- A *reconfigure* flow (`async_step_reconfigure`, `self._get_reconfigure_entry()`) is the
  user-initiated sibling for non-auth settings changes.

### Where credentials live on disk

- Config-entry `data` (including passwords/tokens the flow stored) is persisted by the
  storage helper under the config dir: `STORAGE_DIR = ".storage"` and
  `self.hass.config.path(STORAGE_DIR, self.key)`
  ([homeassistant/helpers/storage.py](https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/storage.py)).
- Config entries use `STORAGE_KEY = "core.config_entries"` (`STORAGE_VERSION = 1`,
  minor 5) ([homeassistant/config_entries.py](https://github.com/home-assistant/core/blob/dev/homeassistant/config_entries.py)),
  i.e. credentials end up in **`/config/.storage/core.config_entries`** (JSON, plain text,
  file-permission protected only). `ConfigEntry.data` and `.options` are
  `MappingProxyType[str, Any]` (immutable — update via
  `hass.config_entries.async_update_entry`); `runtime_data: _DataT` is the typed
  non-persisted per-entry slot (quality-scale rule
  [runtime-data](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/core/integration-quality-scale/rules/runtime-data.md)).

---

## 2. DataUpdateCoordinator for push-plus-poll

Source: [docs/integration_fetching_data.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/integration_fetching_data.md)
and [homeassistant/helpers/update_coordinator.py](https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/update_coordinator.py).

### Constructor (verified against core `dev`)

```python
DataUpdateCoordinator[_DataT].__init__(
    hass: HomeAssistant,
    logger: logging.Logger,
    *,
    config_entry: config_entries.ConfigEntry | UndefinedType | None = UNDEFINED,
    name: str,
    update_interval: timedelta | None = None,
    update_method: Callable[[], Awaitable[_DataT]] | None = None,
    setup_method: Callable[[], Awaitable[None]] | None = None,
    request_refresh_debouncer: Debouncer | None = None,
    always_update: bool = True,
)
```

- **Pass `config_entry` explicitly.** Relying on the implicit `ContextVar` fallback is
  deprecated (core [issue #128077](https://github.com/home-assistant/core/issues/128077),
  [PR #138161](https://github.com/home-assistant/core/pull/138161)); it became an error
  for core integrations in 2026.3 and the fallback is being removed around 2026.8. Custom
  integrations are currently only "ignored" in the enforcement, but new code must pass it.
- Subclass and override `_async_update_data()` (preferred over `update_method`); optional
  `_async_setup()` runs once before the first refresh ("the place to set up your
  coordinator, or to load data, that only needs to be loaded once" — added 2024.8, blog
  `2024-08-05-coordinator_async_setup`).
- In `_async_update_data`: raise `UpdateFailed` for transient API errors,
  `ConfigEntryAuthFailed` for credential errors (triggers reauth, stops updates).
- First load: `await coordinator.async_config_entry_first_refresh()` — raises
  `ConfigEntryNotReady` on failure so HA retries setup with its own backoff. Core now
  enforces preconditions: it raises `ConfigEntryError` if the coordinator has no config
  entry or the entry state is not `SETUP_IN_PROGRESS` (i.e. only call it during
  `async_setup_entry`; elsewhere use `async_refresh()`).
- `always_update=False` skips listener notification when fetched data compares equal
  (`__eq__`) to the previous data — reduces state-machine churn.

### Push (SSE) + poll coexistence

- Push path: when the SSE/webhook listener delivers data, call
  `coordinator.async_set_updated_data(data)`. Verified behavior (core source): "Manually
  update data, notify listeners and reset refresh interval" — it sets `self.data`, sets
  `last_update_success = True`, cancels any scheduled refresh, and **reschedules the next
  poll `update_interval` from now**. It expects the *same shape* of data object that
  `_async_update_data` returns (`_DataT`); it is synchronous (a `@callback`, despite the
  `async_` prefix).
- Because every push resets the poll timer, a modest `update_interval` acts naturally as
  the *fallback* poll: it only fires after `update_interval` of push silence.
- The canonical core exemplar for push-plus-poll is **Withings** (platinum, cloud webhook
  + poll fallback) — [homeassistant/components/withings/coordinator.py](https://github.com/home-assistant/core/blob/dev/homeassistant/components/withings/coordinator.py):

```python
class WithingsDataUpdateCoordinator[_DataT](DataUpdateCoordinator[_DataT]):
    _default_update_interval: timedelta | None = UPDATE_INTERVAL  # timedelta(minutes=10)
    webhooks_connected: bool = False

    def webhook_subscription_listener(self, connected: bool) -> None:
        self.webhooks_connected = connected
        if connected:
            self.update_interval = None                      # push mode: stop polling
        else:
            self.update_interval = self._default_update_interval  # fall back to poll

    async def async_webhook_data_updated(self, ...) -> None:
        await self.async_request_refresh()                   # push event -> debounced fetch
```

  Two valid patterns, both HA-idiomatic:
  1. push carries full data → `async_set_updated_data(data)`;
  2. push is only a "something changed" signal → `await coordinator.async_request_refresh()`
     (debounced; the coordinator re-fetches via `_async_update_data`).
- Setting `self.update_interval = None` disables polling entirely (push-only mode);
  restore it to re-enable. Changing `update_interval` takes effect at the next scheduling.

### Backoff / rate-limit conventions

- Setup retries: `ConfigEntryNotReady` → HA retries with its own (internal, increasing)
  schedule; do not implement your own setup retry loop.
- Poll failures: `UpdateFailed(...)` keeps the normal `update_interval` cadence; entities
  go unavailable via `CoordinatorEntity.available`. Log the failure once and once on
  recovery (quality rule [log-when-unavailable](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/core/integration-quality-scale/rules/log-when-unavailable.md));
  the coordinator's own logging already behaves this way.
- **New:** `UpdateFailed(retry_after=<seconds>)` defers the next scheduled refresh — for
  HTTP 429 / `Retry-After` handling
  ([blog 2025-11-17-retry-after-update-failed](https://github.com/home-assistant/developers.home-assistant/blob/master/blog/2025-11-17-retry-after-update-failed.md);
  shipped with 2025.12). "The `retry_after` parameter is ignored during the Update
  Coordinator setup phase."

  ```python
  except APIClientRateLimited as err:
      raise UpdateFailed(retry_after=60) from err
  ```
- `async_request_refresh()` is debounced: `REQUEST_REFRESH_DEFAULT_COOLDOWN = 10` s,
  `REQUEST_REFRESH_DEFAULT_IMMEDIATE = True` (override via `request_refresh_debouncer=`).
- SSE reconnect backoff itself is the client library's job (not coordinator API); the
  Withings pattern above (flip `update_interval` on listener connect/disconnect) is the
  convention for surfacing it.

### Entities on the coordinator

`class MySensor(CoordinatorEntity[MyCoordinator], SensorEntity)` — `CoordinatorEntity`
provides `should_poll = False`, `available`, `async_added_to_hass` listener wiring, and
`_handle_coordinator_update`. Pass the coordinator in `__init__`; read state from
`self.coordinator.data`.

---

## 3. Entities

Sources: [docs/core/entity.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/core/entity.md),
[docs/core/entity/sensor.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/core/entity/sensor.md),
[docs/core/entity/binary-sensor.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/core/entity/binary-sensor.md),
[docs/core/entity/button.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/core/entity/button.md),
[docs/dev_101_services.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/dev_101_services.md).

### Naming (`has_entity_name`)

- `_attr_has_entity_name = True` is **mandatory for new integrations** (also Bronze
  quality rule `has-entity-name`). "The entity's name property only identifies the data
  point represented by the entity, and should not include the name of the device or the
  type of the entity."
- Friendly-name composition:

  | Scenario | friendly_name |
  |---|---|
  | entity not tied to a device | `entity.name` |
  | entity on a device, entity has a name | `f"{device.name} {entity.name}"` |
  | entity on a device, `name = None` | `f"{device.name}"` |

- `_attr_name = None` means "this entity is the main feature of the device".
- Translated entity names: set `_attr_translation_key = "my_key"` and provide
  `entity.<platform>.<translation_key>.name` in translations (section 4). Do not hardcode
  English names when shipping de/fr.
- Registry basics: `unique_id` "must be unique within a platform" (i.e. per
  platform+domain); required in practice (Bronze rule `entity-unique-id`). Devices are
  created by returning `_attr_device_info: DeviceInfo` (with `identifiers={(DOMAIN,
  entry_or_device_id)}`, `name`, `manufacturer`, `model`, ...) — grouping all of one
  child's entities under one device is the idiom (Gold rule `devices`).
  Diagnostic/config entities set `_attr_entity_category = EntityCategory.DIAGNOSTIC/CONFIG`.
  Noisy/rare entities: `_attr_entity_registry_enabled_default = False`.

### `device_class: timestamp` rendering

- Backend contract: `SensorDeviceClass.TIMESTAMP` — "Requires `native_value` to return a
  Python `datetime.datetime` object, with time zone information, or `None`." No
  `native_unit_of_measurement`, no `state_class` (state classes are for numeric sensors).
- Frontend rendering (verified in the frontend source): timestamp-device-class sensors are
  rendered through `hui-timestamp-display`
  ([hui-sensor-entity-row.ts](https://github.com/home-assistant/frontend/blob/dev/src/panels/lovelace/entity-rows/hui-sensor-entity-row.ts)),
  whose default format is **`relative`** (`return this.format || "relative";`), re-rendered
  every 1000 ms, with formats `relative | total | date | time | datetime`
  ([hui-timestamp-display.ts](https://github.com/home-assistant/frontend/blob/dev/src/panels/lovelace/components/hui-timestamp-display.ts)).
  Relative strings are produced by `Intl.RelativeTimeFormat` with the user's frontend
  locale ([src/common/datetime/relative_time.ts](https://github.com/home-assistant/frontend/blob/dev/src/common/datetime/relative_time.ts)),
  i.e. **"8 minutes ago" is automatic, live-updating, and localized** — an integration
  exposing "last feed at 14:32Z" as a timestamp sensor gets relative display for free.
  (`UPTIME` device class defaults to `total` instead.)

### Platform fit

- `sensor` (`SensorEntity`, `native_value`) — values incl. timestamps
  (`SensorDeviceClass.TIMESTAMP`), counts, durations.
- `binary_sensor` (`BinarySensorEntity`, `is_on: bool | None`) — relevant
  `BinarySensorDeviceClass` values: `CONNECTIVITY` ("On means connected, Off means
  disconnected"), `PROBLEM` ("On means problem detected, Off means no problem (OK)"),
  `RUNNING`, `UPDATE`, `OCCUPANCY`, `PRESENCE`.
- `button` (`ButtonEntity`) — stateless action trigger; implement `press()` or
  `async_press()`; device classes only `IDENTIFY`/`RESTART`/`UPDATE`. (Recent: buttons
  gained standard event types, blog `2026-07-22-button-standard-event-types`.)
  Note: HA shows a button's last-pressed time as its state, but the entity itself is
  documented stateless ("it doesn't provide any specific properties for itself").

### Services (actions) with arguments

- The docs now call these "service actions" (UI says "actions" since 2024.8).
- Register in **`async_setup`** (not `async_setup_entry`, not platform setup) so
  automations validate even when no entry is loaded — Bronze rule
  [action-setup](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/core/integration-quality-scale/rules/action-setup.md):

```python
hass.services.async_register(
    DOMAIN, SERVICE_NAME, handler,
    schema=vol.Schema({...}),                    # voluptuous validation
    supports_response=SupportsResponse.OPTIONAL, # if it returns data
)

@callback  # or async
def handler(call: ServiceCall) -> ServiceResponse | None:
    value = call.data["param_key"]               # already schema-validated
```

  Response data "must be a `dict` and serializable in JSON"; check
  `call.return_response` when `SupportsResponse.OPTIONAL`.
- Entity services (act on targeted entities): the current recommended API is the helper
  `service.async_register_platform_entity_service(hass, DOMAIN, SERVICE_NAME,
  entity_domain=..., schema={vol.Required("param"): cv.validator}, func="entity_method")`
  called from `async_setup` — this replaced calling
  `platform.async_register_entity_service` during platform setup
  ([blog 2025-09-25-entity-services-api-changes](https://github.com/home-assistant/developers.home-assistant/blob/master/blog/2025-09-25-entity-services-api-changes.md)).
  The handler object is a plain `ServiceCall`; targeting resolves entities for you.
- `services.yaml` (in the integration dir) describes each action for the UI:
  `target:` (entity domain filter) and `fields:` with `required:` and `selector:` per
  field. **Names/descriptions do not go in `services.yaml`** — they live in translations
  under `services.<service>.name/description/fields` (section 4). Target level
  convention: "target the thing the action actually acts on" — `entity_id` vs `device_id`
  vs `config_entry_id`.

---

## 4. Translations (en/de/fr)

Sources: [docs/internationalization/custom_integration.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/internationalization/custom_integration.md),
[docs/internationalization/core.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/internationalization/core.md).

- **Custom integrations must NOT rely on `strings.json`**: "Do not use `strings.json` for
  custom components" — it is a "build-time feature used only by Home Assistant Core".
  "If you use `strings.json` or placeholders, your config flow will fail to load
  translations and show raw keys."
- Ship a `translations/` directory inside the integration:
  `custom_components/<domain>/translations/en.json`, `de.json`, `fr.json` — BCP47 language
  codes, each file a **complete flat copy** of all keys ("manually create the
  `translations/en.json` file and include the full, flat English text for every key").
  Same schema as core's `strings.json`. Validate with hassfest.
- Key structure (identical to core `strings.json`):

```jsonc
{
  "config": {
    "step": { "user": { "title": "...", "description": "...",
                        "data": { "api_key": "API key" },
                        "data_description": { "api_key": "..." } },
              "reauth_confirm": { "title": "...", "description": "..." } },
    "error": { "invalid_auth": "..." },
    "abort": { "already_configured": "...", "reauth_successful": "..." }
  },
  "options": { /* same structure as config */ },
  "entity": {
    "sensor": { "<translation_key>": { "name": "Last feed",
                                       "state": { "<state_value>": "..." } } }
  },
  "services": {
    "<service_name>": { "name": "...", "description": "...",
      "fields": { "<field>": { "name": "...", "description": "..." } } }
  },
  "issues": { "<issue_id>": { "title": "...", "description": "..." } }
}
```

- Entity name translation requires `has_entity_name = True` plus
  `_attr_translation_key` matching `entity.<platform>.<key>.name`.
- (Core-only nicety: `[%key:...%]` references — those are resolved at core build time;
  in custom integrations write the literal text in every file.)

---

## 5. Repair issues

Source: [docs/core/platform/repairs.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/core/platform/repairs.md).

```python
from homeassistant.helpers import issue_registry as ir

ir.async_create_issue(
    hass,
    DOMAIN,
    "hosting_paused",                       # issue_id — stable, used to clear it later
    is_fixable=False,                       # True only if a RepairsFlow can fix it
    is_persistent=False,
    severity=ir.IssueSeverity.ERROR,        # or WARNING
    translation_key="hosting_paused",       # -> issues.<key>.title/.description
    translation_placeholders={"name": ...}, # optional
    learn_more_url="https://...",           # optional
    # breaks_in_ha_version="2026.9.0",      # only for deprecation-style issues
)
```

- Full parameter set: `domain`, `issue_id`, `breaks_in_ha_version`, `data`, `is_fixable`,
  `is_persistent`, `issue_domain`, `learn_more_url`, `severity`, `translation_key`,
  `translation_placeholders`.
- Clear it when the condition resolves (idempotent — safe to call when absent):
  `ir.async_delete_issue(hass, DOMAIN, "hosting_paused")`.
  Re-creating with the same `issue_id` updates the existing issue.
- For a *hosting paused / subscription lapsed* case, `is_fixable=False` with
  `learn_more_url` pointing at the billing page is the fit; a fixable issue instead ships
  a `repairs.py` with `async_create_fix_flow(hass, issue_id, data)` returning a
  `RepairsFlow` subclass (first step `async_step_init`, confirm via
  `self.async_create_entry(title="", data={})`).
- Titles/descriptions come from translations: `issues.<issue_id>.title` / `.description`
  (with placeholder interpolation) — section 4.
- Quality-scale rule [repair-issues](https://github.com/home-assistant/developers.home-assistant/blob/master/docs/core/integration-quality-scale/rules/repair-issues.md)
  (Gold): repair issues should be actionable for the user.

---

## 6. HACS installability & min-HA-version

Sources: [source/docs/publish/start.md](https://raw.githubusercontent.com/hacs/documentation/main/source/docs/publish/start.md),
[source/docs/publish/integration.md](https://raw.githubusercontent.com/hacs/documentation/main/source/docs/publish/integration.md)
(rendered at hacs.xyz/docs/publish/...), plus
[ludeeus/integration_blueprint](https://github.com/ludeeus/integration_blueprint) as the
HACS-recommended template.

Repo requirements:

- Public GitHub repo ("Only public repositories on GitHub will work with HACS"), with a
  GitHub description, topics, and a README.
- One integration per repo; **all files under `custom_components/<domain>/`**
  (e.g. `custom_components/awesome/__init__.py`, `.../manifest.json`). `"content_in_root":
  true` in `hacs.json` is the only escape hatch.
- `manifest.json` must include: `domain`, `documentation`, `issue_tracker`, `codeowners`,
  `name`, `version`. Per the HA manifest doc
  ([docs/creating_integration_manifest.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/creating_integration_manifest.md)):
  `version` is "required for custom integrations"; also set `config_flow: true`,
  `integration_type` (e.g. `"hub"` or `"service"`), `iot_class` (`cloud_polling` /
  `cloud_push`), `requirements` (pip deps), optionally `single_config_entry`,
  `quality_scale`.
- `hacs.json` at the **repo root**, `name` required. Documented keys: `name`,
  `content_in_root`, `zip_release` (+`filename`), `hide_default_branch`, `country`,
  `homeassistant`, `hacs`, `persistent_directory`.
- **Minimum-HA-version check = `"homeassistant": "<version>"` in `hacs.json`** — "Minimum
  required Home Assistant version"; HACS refuses to install/offer versions on older HA.
  Exemplar (integration_blueprint, fetched 2026-08-27):

```json
{ "name": "Integration blueprint", "homeassistant": "2026.6.4", "hacs": "2.0.5" }
```

- Releases vs default branch: "With releases: latest release tag determines remote
  version" (users are shown "the 5 latest releases together with the default branch");
  without releases HACS falls back to the default branch, versioned by the first 7 chars
  of the last commit. **Tag GitHub releases** — that is the conventional distribution
  unit; `zip_release: true` + `filename` if you attach a zip asset instead of using the
  tagged tree.
- Brand assets: "You must provide brand assets for your integration" via
  [home-assistant/brands](https://github.com/home-assistant/brands) (icon.png at minimum);
  the HACS validate action can `ignore: brands` while pending.
- CI convention (from integration_blueprint `.github/workflows/validate.yml`): run both
  `home-assistant/actions/hassfest` and `hacs/action` with `category: integration`.

---

## 7. Testing

Source: [MatthewFlamm/pytest-homeassistant-custom-component README](https://github.com/MatthewFlamm/pytest-homeassistant-custom-component)
(fetched 2026-08-27 — actively maintained, no successor).

- `pytest-homeassistant-custom-component` is still the current story: it extracts "testing
  plugins from Home Assistant for custom component testing", providing "the same
  functionality as the tests in home-assistant/core" — the `hass` fixture,
  `MockConfigEntry`, `async_fire_time_changed`, etc., imported from
  `pytest_homeassistant_custom_component.common`.
- "Updated daily according to the latest homeassistant release including beta."
  Versioning: patch bumps are "automatic update with a homeassistant version"; minor bumps
  mean the extraction itself changed — pin the version matching your target HA release.
- Required config: `asyncio_mode = auto` (pytest-asyncio), and the
  `enable_custom_integrations` fixture must be active for custom integrations (typical
  conftest.py: an autouse fixture depending on `enable_custom_integrations`).
- Test layout convention (mirrors core): `tests/` beside `custom_components/`, config-flow
  tests achieving full flow coverage (Bronze rule `config-flow-test-coverage`), setup
  tests (`test-before-setup`), and Silver rule `test-coverage` asks for above 95 % on the
  integration.
- Validation in CI: hassfest + HACS action (section 6).

---

## 8. Quality scale: what matters for a custom integration

Source: [docs/core/integration-quality-scale/index.md](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/core/integration-quality-scale/index.md),
rules list at [docs/core/integration-quality-scale/rules/](https://github.com/home-assistant/developers.home-assistant/tree/master/docs/core/integration-quality-scale/rules),
tier mapping from [`_includes/tiers.json`](https://raw.githubusercontent.com/home-assistant/developers.home-assistant/master/docs/core/integration-quality-scale/_includes/tiers.json).
Scale introduced in its current form Nov 2024 (blog `2024-11-20-integration-quality-scale`).

- Tiers: Bronze ("baseline standard and requirement for all new integrations"), Silver
  (runtime reliability), Gold (UX completeness), Platinum (code perfection), plus special
  tiers **No score / Internal / Legacy / Custom**. Custom integrations are shown as tier
  "Custom": "Developed and distributed by the community … not included in the official
  Home Assistant releases"; "The Home Assistant project does not review, security audit,
  maintain, or support third-party custom integrations." So the scale is formally a
  core-review instrument — but its rules are the definitive checklist of idioms, and the
  manifest `quality_scale` key may be set by custom integrations (manifest doc: bronze
  minimum recommended). Core integrations track compliance in a `quality_scale.yaml`;
  for a custom integration that file is optional self-documentation.
- Tier mapping (complete, from tiers.json):
  - **Bronze:** action-setup, appropriate-polling, brands, common-modules,
    config-flow-test-coverage, config-flow, dependency-transparency, docs-actions,
    docs-triggers, docs-conditions, docs-high-level-description,
    docs-installation-instructions, docs-removal-instructions, entity-event-setup,
    entity-unique-id, has-entity-name, runtime-data, test-before-configure,
    test-before-setup, unique-config-entry
  - **Silver:** action-exceptions, config-entry-unloading, docs-configuration-parameters,
    docs-installation-parameters, entity-unavailable, integration-owner,
    log-when-unavailable, parallel-updates, reauthentication-flow, test-coverage
  - **Gold:** devices, diagnostics, discovery-update-info, discovery, docs-data-update,
    docs-examples, docs-known-limitations, docs-supported-devices,
    docs-supported-functions, docs-troubleshooting, docs-use-cases, dynamic-devices,
    entity-category, entity-device-class, entity-disabled-by-default, entity-translations,
    exception-translations, icon-translations, reconfiguration-flow, repair-issues,
    stale-devices
  - **Platinum:** async-dependency, inject-websession, strict-typing
- **Rungs that matter for a custom cloud integration** (behavioral, user-visible):
  Bronze `config-flow`, `unique-config-entry`, `entity-unique-id`, `has-entity-name`,
  `runtime-data`, `action-setup`, `appropriate-polling`, `test-before-configure`,
  `test-before-setup`; Silver `reauthentication-flow`, `entity-unavailable`,
  `log-when-unavailable`, `config-entry-unloading`, `parallel-updates`,
  `action-exceptions`; Gold `devices`, `entity-device-class`, `entity-translations`,
  `entity-category`, `repair-issues`, `diagnostics`, `reconfiguration-flow`,
  `stale-devices`, `dynamic-devices`. Platinum's `async-dependency`/`inject-websession`
  (pass `async_get_clientsession(hass)` into your client) and `strict-typing` are cheap
  wins worth adopting.
- **Core-submission-only rungs** (skip or reinterpret for HACS): `brands`
  (home-assistant/brands PR — needed anyway to avoid the "missing image" tile, but the
  HACS action can ignore it), `integration-owner`, `dependency-transparency` (PyPI
  publishing rules), all `docs-*` rules (they mandate pages on home-assistant.io — for a
  custom integration the README fills this role), `discovery`/`discovery-update-info`
  (only for discoverable local devices).

---

## Recent-change ledger (things that differ from pre-2025 training-era knowledge)

| Change | Since | Source |
|---|---|---|
| Config-flow dev docs moved to `docs/core/integration/{config_flow,options_flow}.md` | 2025/2026 restructure | 404 on old paths, new files present on master |
| `_get_reauth_entry()` / `_get_reconfigure_entry()` / `_abort_if_unique_id_mismatch()` / `async_update_reload_and_abort(data_updates=...)` | 2024.11 era | blog 2024-10-21 |
| `OptionsFlowWithConfigEntry` + manual `self.config_entry` deprecated; property auto-provided | 2024.11 (window to 2025.12) | blog 2024-11-12 |
| `OptionsFlowWithReload` replaces the update-listener idiom | 2025.8 | 2025.8 changelog, options_flow.md |
| update-listener + reloading flow methods together: deprecated 2026.6, error 2026.12 | 2026.6 | blog 2026-05-07 |
| `show_advanced_options` deprecated, removed 2027.6 | 2026.6 | blog 2026-05-26 |
| Coordinator `config_entry` must be passed explicitly (ContextVar fallback removal ~2026.8) | 2025.x→2026.x | core issue #128077, PR #138161 |
| Coordinator `_async_setup()` hook | 2024.8 | blog 2024-08-05 |
| `UpdateFailed(retry_after=...)` | 2025.12 | blog 2025-11-17 |
| `FlowResult.result` removed; type is `ConfigFlowResult` | 2025.8 era | blog 2025-07-31 |
| Entity services: register via `service.async_register_platform_entity_service` in `async_setup` | 2025.10 era | blog 2025-09-25 |
| Quality scale reworked into Bronze/Silver/Gold/Platinum rule system | 2024.12 | blog 2024-11-20 |
| Service/action names & descriptions moved out of `services.yaml` into translations | pre-2025, still current | dev_101_services.md |
