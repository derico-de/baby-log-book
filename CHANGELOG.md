# Changelog

All notable changes to Baby Log Book are recorded here, newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow the release numbering that is kept in sync with the docker
container tags. Every change lands under **Unreleased** when it is made, and a
release moves that section under its version number.

## [Unreleased]

### Fixed

- A new feeding ends the Feed that was still running, whoever logged it. The
  rule lived in the feed sheet, so it held for one writer only: two phones that
  each started a Feed while offline left both running, and the day's numbers
  read as though she had eaten twice at once. The server now holds it, in the
  same transaction as the rest of a push — both rows survive with their
  millilitres, each earlier Feed carries the end it in fact had, and the sheet
  still says *ends the running feed at 14:05* before saving.

## [1.25.0] - 2026-09-09

### Changed

- An entry's History shows the values a correction changed, not only the field
  it changed: each one reads `120 ml → 150 ml` under the line that names it, so
  a disputed amount can be read back without guessing. A correction that touched
  several fields at once labels each of them, an emptied field says *not set*,
  and a tick taken away reads *Yes → No* rather than disappearing.

## [1.24.0] - 2026-09-09

### Changed

- Stats counts Naps less than 30 minutes apart as one nap. She stirs, somebody
  stops the timer, and she is back down ten minutes later — two rows, one nap.
  The longest stretch is now the whole nap rather than its longest half; only
  the minutes she slept are summed, so the day's total is unchanged.

## [1.23.0] - 2026-09-08

### Added

- Birth weight and birth length, on the Baby in settings beside her birth date.
  What they write is an ordinary measurement dated the day she was born — the
  same fact a check-up records — so the growth curves start at birth. Both are
  optional, and a birth date somebody corrects takes the measurement with it.

### Changed

- The growth curve reads as a curve on the handful of points a real Baby has:
  the interior tangents are weighted by the gaps either side, so unevenly
  spaced check-ups no longer put a kink at every point, and the two ends carry
  a parabolic tangent, so a series leaves birth on a bend rather than on a
  straight run-in. Still monotone — it cannot invent a dip between two rising
  measurements. Two measurements are still drawn as the straight line they are.

## [1.22.0] - 2026-09-08

### Added

- Weight and height are trend cards of their own: a smooth line over her whole
  life rather than seven bars, because a Baby is weighed at a check-up and a
  rolling week of measurements is one column and six gaps. The curve is
  monotone, so it can never dip between two rising measurements.
- A month view on the stats grid — four whole weeks, so stepping it keeps every
  weekday in the same column.

### Changed

- Night Sleep and Naps are drawn in two colours, on the grid and on the Sleep
  card, and the card states both figures: the same eleven hours as one night
  and as six naps are not the same day. Both are named in words beside the
  colours, and in every column's hidden list.
- Trends is the first tab and the one the stats screen opens on. *Is this
  getting better* is the question somebody arrives with.
- The Day view is gone. What one day held is the timeline's question, answered
  better on the home screen; the grid's own job starts at seven columns.
- Measurements are off the day grid. A weight is a fact about a Baby and not
  about a time of day, so a disc at 14:20 on a Tuesday said nothing — it has a
  card in Trends instead.

### Fixed

- Turning off every legend chip on the grid drew every type again instead of
  none.

## [1.21.0] - 2026-09-06

### Changed

- The Feeds card states its average in millilitres beside today's intake. How
  many times she fed on an average day is not a fact anybody acts on.
- The Sleep card's night-and-nap line is a daily average rather than a
  seven-day total that read like one night.

## [1.20.1] - 2026-09-06

### Changed

- The trend charts are twice as tall, so a day's shape is readable rather than
  guessed at.

## [1.20.0] - 2026-09-06

### Changed

- The Feeds bars on the Trends tab draw what she drank that day rather than how
  often she fed, once a bottle exists in the window; a breastfed week still
  counts rounds.
- A day with nothing on it draws no bar at all on the trend cards — the stub
  that kept small days visible no longer makes an empty day look like a day.
- Claude Code's machine-local settings are ignored by Git.

## [1.19.2] - 2026-09-05

### Fixed

- The Caregiving switch no longer silences the Parents. Switching it off says
  *nobody is looking after her*, which is a statement about who is standing
  in — so the Caregivers' phones go quiet (Feed and Sleep Notices, the bottle
  push and the in-app Bottle Chime alike) and a Parent keeps every reminder
  she has switched on. A Hub is a Caregiver, so a wall panel goes quiet with
  the rest of the cover (ADR-0041).

## [1.19.1] - 2026-08-29

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
