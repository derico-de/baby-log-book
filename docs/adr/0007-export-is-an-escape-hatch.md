# The Export is an escape hatch, not a backup

The Export produces a zip of CSV files — one per entry type plus the reference tables — containing every Entry in the Household, all Babies, all time, with no options. It is complete and machine-readable, and it is deliberately **not** a format this app can read back in. We chose this over designing a round-trippable export because the moment CSV becomes a restore format it has to carry Revisions, soft deletes and identity faithfully enough to rebuild the database, which freezes the schema against a file format we would then never be able to change. The genuine backup already exists and is better: the SQLite file on the mounted volume, which the person running this server can copy.

## Consequences

- **Completeness is the design constraint, readability is the happy accident.** Soft-deleted entries are exported and flagged, and the full Revision chain ships as its own `revisions.csv`, because an export that silently drops rows the app still holds is not an escape hatch. Entry files carry only `logged_by` / `edited_at` / `deleted_at` alongside current values, so the readable files stay readable.
- **No filters, and therefore no export UI.** One button. A per-Baby or date-ranged export is a different feature with a different justification; `baby_id` is a column, and a spreadsheet can do the rest.
- **The shape is forced by the domain, not chosen.** A Meal holds several Foods and does not fit one row, so a single wide CSV was never available — `meals.csv` and `meal_foods.csv` are two files, and once there are two there is no reason not to give every entry type its own columns.
- **Headers and enum values stay English in a trilingual app.** The Export is read by machines and by future-you, not by the Member's UI language. This is the one surface in the app that is deliberately not localised.
- **It is produced in the browser from the local replica**, so it works offline and needs no endpoint. This is only viable because every Member holds the whole Household's log — if per-Member visibility scoping is ever introduced, the Export has to move to the server or admit it is partial.
- **If an import is ever wanted, it will not be built on this.** It would be a separate format carrying Revisions as the sync layer already does — see [ADR-0003](0003-revisions-are-the-sync-unit.md).
