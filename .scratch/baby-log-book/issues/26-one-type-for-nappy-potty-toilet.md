# 26 — One entry type for the nappy, the potty and the toilet

Type: grilling
Status: **resolved 2026-08-21** — *Pee & poop* and the `where` field both shipped: three locales, the form, the entry sheet, the timeline meta line, the export column, a Device Setting, glossary and spec.

## Question

A **Nappy** is "a nappy change, recording what was in it". The moment a Baby uses a potty, that name is wrong for the thing being logged — and the app has nowhere to say *where it landed*. Renaming to *Diaper* was raised and points the wrong way: it is the same word in a different dialect, and it fails on exactly the same day.

So: **what is this entry type actually called, and does it need a `where`?**

The type has to survive the whole arc — newborn nappies, potty training with both in the same week, and a three-year-old who uses the toilet — without the log changing shape or the past being renamed under anyone.

## What is not in question

- **It stays one entry type.** The facts recorded are the same two booleans plus a consistency; only the receptacle changes. Two types would split one timeline, split the stats card, and make "how many poops today" a two-source question ([ADR-0001](../../../docs/adr/0001-single-entries-table.md)'s argument, one level up).
- **The stored discriminator stays `nappy`.** A UI name is not a column. Renaming the term costs six English strings and a glossary entry; renaming the discriminator costs a migration, a protocol question and every old export's parseability. There is no case for the second — and `nappies.csv` should keep its filename for the same reason: someone has a 2026 export in a folder.
- **The row title keeps saying the facts.** A timeline row reads *Pee · Oma · 14:05* today; the type name lives on the fan row, the filter chip, the stats card and the sheet. That is what makes this a labelling decision rather than a rewrite, and it is why the naming argument is smaller than it looks.

## The name — three candidates

### A. "Pee & poop" — name the facts (recommended)

The category is named after what is in it, which is the one thing that never changes with the child's age. A potty pee is still a pee.

- **Ages perfectly**, needs no explanation, and is already the app's own vocabulary — *Pipi · Kaka*, *pipi · caca* are the words in the German and Romanian UI today.
- **No euphemism.** This app says *She's awake* and *Off her tummy*; it does not do coy.
- Costs: it is a phrase rather than a noun, which reads slightly odd as a glossary term, and it is wider than *Nappy* on a filter chip. The stats card becomes *Pee & poop* and counts events rather than nappies — which is what it counts today anyway.

### B. "Business" — name the event, warmly

*Business · pee · 14:05.* Covers every receptacle, ages with the child, and is idiomatic in all three languages — German has **großes/kleines Geschäft**, Romanian has **a-și face nevoile**.

- The warmest option, and the one a parent would actually say out loud.
- Costs: it is a euphemism in a UI that has none, it is vague on a chip until you have learned it, and *Geschäft* alone reads as *shop* to a German eye without the glyph beside it. Charm that needs a footnote is not charm.

### C. Keep "Nappy", add a `where`

Smallest change: the term stands, and a field says nappy / potty / toilet.

- Costs: the type name lies for every potty entry, and the stats card called *Nappies* counts things that were not nappies. It buys a year and then this ticket reopens — which is the same trade that made *Diaper* the wrong answer.

## The `where`, whichever name wins

- **A nullable field on the payload** — `nappy` / `potty` / `toilet` — additive, so no protocol bump and no migration ([spec §5.5](../spec.md)). Old rows read as null, which is honest: nobody said, and at the time nobody had to.
- **Never defaulted silently.** A prefilled *nappy* is the app writing a fact nobody entered. The way out already has precedent: the **Feeding default** Device Setting ([issue 21](21-feeding-defaults.md)) — the form opens the way *this Device* says it usually goes, stated in Settings, never learned. During training the household flips it to *potty* and the sheet opens there.
- **Shown on the meta line**, beside who logged it — *Pee · Oma · potty* — not in the title, because the title is the facts and the receptacle is the detail. Same shelf as *nap* and *sleep feed*.
- **One hue, one glyph.** A potty glyph is a later nicety, not part of this; identification is by label as everywhere else ([ADR-0026](../../../docs/adr/0026-entry-types-get-their-own-colour.md)).
- **Export gains one `where` column** in the file it already has.

## Decisions to reach

1. **The name.** A, B, or C — and whether the glossary term and the UI label are allowed to differ (they are not, anywhere else in this app).
2. **Whether `where` ships with the rename or after it.** The rename alone is an afternoon; the field is a form row, a Device Setting, a meta line and an export column.
3. **What happens to the accumulated past.** Nothing, is the proposal: old rows keep a null `where` rather than being backfilled as nappies. A backfill would be the app asserting a fact about a year it was not asked about.

## Answer — the name

**Candidate A. The type is *Pee & poop*** — named after the two facts it holds, never after what caught them.

| | |
|---|---|
| English | **Pee & poop** |
| German | **Pipi & Kaka** |
| Romanian | **Pipi & caca** |

Each half is the word the form's own toggle already says in that language, so the category and its fields cannot drift into two vocabularies — and a test now asserts exactly that, along with the property that made the name worth having: **no translation names a receptacle**, in any of the three. It is also not the widest chip in the rail in any language; *Measurements*, *Meilensteine* and *Timp pe burtică* all run longer.

Rejected as recorded above: *Business* (a euphemism in a UI that has none, and *Geschäft* alone reads as *shop*), and keeping *Nappy* with a field bolted on (buys a year, reopens this ticket).

**What did not change, deliberately:** the stored discriminator is still `nappy`, `nappies.csv` is still `nappies.csv`, and the timeline row still reads *Pee · Oma · 14:05*. The rename cost four strings per language, a glossary entry and two lines of spec — which is the whole argument for having treated it as a labelling decision.

## Answer — the `where`

Built as designed, with one thing worth stating plainly because it looks like a contradiction:

**It is the one prefilled field on a form whose whole rule is that nothing is prefilled.** The two facts stay untouched — a ticked-by-default Pee would be the app inventing what happened — but `where` opens on this **Device's stated default**, nappy or potty or toilet, exactly the shape of the [Feeding default](21-feeding-defaults.md). The distinction that makes it consistent rather than an exception: *pee and poop are facts about this event, and the receptacle is a fact about this phase of this child's life.* A household in training states it once in Settings instead of tapping it forty times a week, and the form shows the answer rather than hiding it.

Everything else landed as written:

- **Nullable, additive, no migration and no protocol bump.** A row from before the field says nothing.
- **Never backfilled, and the silence is never read as a nappy** — not in the sheet, which opens with no receptacle selected on an old row, and not in `nappies.csv`, where the new `where` column is simply empty. Asserted by test in both places.
- **The meta line shows it only when it is not the nappy.** *Pee · Oma · Potty*; a nappy on every row of a household that has never seen a potty is a word doing no work.
- **Correctable like any other field**, under the same rules the form saves by.

Nappy / Potty / Toilet · Windel / Töpfchen / Toilette · Scutec / Oliță / Toaletă.

## What this ticket did not do

**Nothing about the fan.** Pee & poop is still one row of six, and the receptacle lives inside the form rather than earning rows of its own — which is [ticket 27](27-the-fan-is-out-of-room.md)'s constraint doing its job for the first time.
