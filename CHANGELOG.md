# Changelog

All notable changes to Baby Log Book are recorded here, newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow the release numbering that is kept in sync with the docker
container tags. Every change lands under **Unreleased** when it is made, and a
release moves that section under its version number.

## [Unreleased]

### Fixed

- The Night Period no longer moves a Feed's due instant to the Day Start
  before the night has begun: an afternoon feed whose interval reaches past
  the stated hour keeps its due as stated — the bedtime feed is still to
  come — and only from that hour on does the header predict the morning. The
  Feed Notice now also gives its head start for the bedtime feed instead of
  staying silent until dawn (ADR-0040).

## [1.19.0] - 2026-08-28

### Added

- This changelog.
- A Caregiving switch in Settings: switching it off pauses every reminder for
  the whole Household — the Feed and Sleep Notices, the bottle push, and the
  in-app Bottle Chime — without touching what any of them is set to, so
  switching it back on restores the routine as it was.
- The quick-log fan curves around its button, and a fan row is a form rather
  than a new entry type (ADR-0035).

### Documentation

- Groundwork for the Home Assistant wall-panel integration: the decisions are
  recorded (ADR-0034 through ADR-0039 — a Hub is a Device, the deployment
  never wakes it, a Rescue Link is minted from Settings, the integration gates
  on the server release), a Home Assistant instance stands beside the dev
  environment, and the wire contract and action surface are specified. The
  integration itself ships separately.

## [1.18.0] - 2026-08-26

### Changed

- A Sleep that reaches into the Night is a Night Sleep, and a bedtime that
  collapses is no longer counted as a Nap (ADR-0033).

## [1.17.0] - 2026-08-25

### Added

- A Household can state when its night begins: a Feed that would fall due
  inside the Night Period comes due at the Day Start instead (ADR-0032).

## [1.16.0] - 2026-08-25

### Changed

- The due line names the clock face it lands on, and the *next due* column
  carries the marker.

## [1.15.0] - 2026-08-23

### Added

- A Feed due and a Wake Window up wake the phone too, at the offset the
  Household states (ADR-0031) — push reminders beyond the Bottle Chime.

## Earlier releases

Releases v1.0.0 through v1.14.0 predate this file; their history lives in the
git log, one tag per release.
