# Baby Log Book

A shared log of a baby's day — feeds, sleep, nappies, solids and growth — kept by the people who look after them, on phones that are often offline.

## Language

### People and scope

**Household**:
The circle of people who look after the same babies, and the boundary of all shared data.
_Avoid_: Family, group, team, account

**Baby**:
A child whose life is being logged. A Household may have several.
_Avoid_: Child, infant, kid

**Member**:
A person with access to a Household. Every Entry records the Member who logged it.
_Avoid_: User; Parent or Caregiver as a synonym for Member — those are roles a Member holds

**Parent**:
A Member who may manage the Household — invite people, add Babies, delete Entries.
_Avoid_: Owner, admin

**Caregiver**:
A Member who may log and correct, but not manage the Household. Sees everything a Parent sees.
_Avoid_: Guest, viewer, read-only member

**Removed**:
The end state of a Membership. The Member and every Entry they logged remain, so the timeline still says who did what years later; what ends is access.
_Avoid_: Deleted member, deactivated, disabled

### Getting in

**Device**:
One phone, tablet or browser holding its own replica. Access is granted to a Device rather than to a Member in the abstract, so the same person on a second phone claims again.
_Avoid_: Client, install, session (as a synonym for Device)

**Device Setting**:
A preference belonging to one Device alone, which never travels to the others. Distinct from the Household's settings, which every Device shares: how dark the screen is depends on the room this phone is in, and being nudged to install depends on this phone not having been. What makes it a category rather than an exception is that it is answering a question about *this* phone, not about the Household.
_Avoid_: Local setting, user preference, app setting

**Claim Link**:
A single-use link that binds a Device to a Member. The only way into a Household — there is no password and no sign-up.
_Avoid_: Login link, magic link, token

**Claim**:
The act of taking up a Claim Link, which is what puts a Member on a Device.
_Avoid_: Sign up, register, log in

**Invite**:
A Claim Link a Parent creates for someone not yet in the Household, carrying the name and role they will have. Becomes a Member only when claimed.
_Avoid_: Invitation code, join link

**Rescue Link**:
A Claim Link minted from the server itself, re-binding a Member who exists to a new Device. For the phone that was lost when no Parent is left to send an Invite.
_Avoid_: Recovery code, password reset, admin override

### What gets logged

**Entry**:
Anything recorded about a Baby at a point in time. The umbrella term for Feeds, Meals, Sleeps, Nappies, Measurements and Milestones.
_Avoid_: Event, record, log line, activity

**Feed**:
Milk taken by a Baby — either at the breast or from a bottle. A Feed is anchored by when it *started*; everything downstream is measured from that, and its end is optional detail. One bottle is one Feed, so a sitting that runs through two of them is a Combined Feed.
_Avoid_: Nursing, feeding session

**Meal**:
Solid food eaten by a Baby. Holds several Foods, each of which may be that Baby's first time.
_Avoid_: Solids entry, food log

**Food**:
A named item in the Household's growing catalogue — "carrot", "yoghurt" — reusable across Meals.
_Avoid_: Ingredient, dish, item

**Sleep**:
A stretch of time a Baby was asleep. Whether it counts as a nap or as night sleep follows from the Day Start, and is never recorded.
_Avoid_: Nap, rest

**Sleep Feed**:
A Feed that overlaps a running Sleep, because a Baby can take the breast or a bottle without waking. Follows from the overlap and is never recorded on the Feed itself.
_Avoid_: Dream feed (which names only the pre-bedtime one), night feed

**Combined Feed**:
One sitting of milk taken from more than one source — pumped breast milk, then formula — logged as the several Feeds it was rather than as one. Follows from two Feeds close together and is never recorded as such, which is why nothing merges them.
_Avoid_: Mixed feed, top-up, supplement

**Leftover**:
What is still in the bottle when a Feed is over. Kept beside the volume that went in rather than subtracted from it, because they are two facts learned at two moments: what she was offered is known at the start, what she drank only at the end.
_Avoid_: Waste, remainder, unfinished

**Nappy**:
A nappy change, recording what was in it.
_Avoid_: Diaper, change

**Measurement**:
A Baby's weight, height or head circumference at a point in time.
_Avoid_: Growth entry, metric, stat

**Milestone**:
Something a Baby did for the first time, recorded as a name and the moment it happened. One line, no photo and no prose — what keeps the log a log rather than a baby book. Unrepeatable, which is why it is in the app from the start: a first tooth that happened while nothing could record it is gone.
_Avoid_: Achievement, first, event, memory

**Milestone Name**:
The words on a Milestone — "first tooth", "rolled off the sofa" — written by the Member who logged it and stored as they wrote them. Suggested from what the Household has already used, never drawn from a fixed list, so a Milestone can be anything that mattered.
_Avoid_: Milestone type, label, category

**Note**:
Optional free text on any Entry. Where everything the model deliberately does not capture goes.
_Avoid_: Comment, description, remark

**Revision**:
A recorded change to an Entry, kept forever. What lets the timeline say "edited by Oma, was 120 ml", and what makes a correction or a deletion recoverable rather than final.
_Avoid_: Version, edit, audit entry

### Time

**Day Start**:
The hour at which a new day begins for this Household. Set deliberately rather than assumed to be midnight, so a 01:30 Feed belongs to the night before. It is an hour rather than an instant, and the hour travels: days are cut at it in the Household Zone, while on every Device it is also where the app's deep night ends, read against that Device's own clock.
_Avoid_: Cutoff, day boundary, reset time

**Night Sleep**:
The Sleep that crosses the Day Start. One boundary settles both ends of the night, so nothing about it is recorded.
_Avoid_: Overnight, bedtime sleep, main sleep

**Nap**:
Any Sleep that does not cross the Day Start.
_Avoid_: Daytime sleep, rest

**Target**:
An interval a Member sets for a Baby, which the app reports elapsed time against. Always stated, never learned from the log.
_Avoid_: Schedule, goal, reminder, alarm

**Feed Interval**:
The Target for feeding, measured from the previous Feed's start.
_Avoid_: Feeding schedule, feed gap

**Wake Window**:
The Target for sleep — how long a Baby is comfortably awake — measured from the last Sleep's end.
_Avoid_: Awake window, sleep schedule, sleep interval

**Bottle Life**:
The Target for a started bottle — how long the Household is willing to go on offering one — measured from the Feed's start. A number a Member typed, never a health guideline the app fetched, and the countdown it drives is on the bottle that is still open rather than on the Baby. Because the Feed's start is the only instant the model has, it reads younger than the milk whenever the bottle was made up earlier.
_Avoid_: Freshness, expiry, shelf life, safe until

**Live Session**:
A Feed or Sleep that has started but not yet ended. Visible as a running timer on every Member's device.
_Avoid_: Active entry, open session, timer

**Stale Session**:
A Live Session still running long after it plausibly ended, because nobody pressed stop. Harmless for a Feed, whose end carries no meaning; corrupting for a Sleep, whose end is the whole point.
_Avoid_: Orphaned session, forgotten timer, zombie entry

**Session Merge**:
What happens when two Members each start a **Sleep** for the same Baby — a Baby cannot be asleep twice, so the two are reconciled into one, keeping the earlier start. Sleeps only: an open Feed beside an open Sleep is a Sleep Feed, and two open Feeds are a Combined Feed. The surviving Sleep also absorbs a late stop pressed on the device whose Sleep lost. Attributed in the Revision history to the app rather than to a Member, because no person did it.
_Avoid_: Conflict resolution, deduplication, auto-merge

**Occurred At**:
When something happened to the Baby — as distinct from when a Member got round to logging it. An instant, so it names the same moment wherever it is read; the wall time anyone sees is that instant projected through a zone.
_Avoid_: Timestamp, created at, date

**Household Zone**:
The time zone the Household's days are cut in — what turns the Day Start from an hour into an instant. One zone for everyone, so "yesterday" means one thing however far apart Members are. Changing it re-reads the whole past through the new lens.
_Avoid_: Timezone (unqualified), local time, device time

**Recording Zone**:
Where a Device was when an Entry was created. Kept because it can never be recovered afterwards, and never rewritten when someone corrects that Entry from somewhere else.
_Avoid_: Entry timezone, offset, device timezone

### Getting data out

**Export**:
Everything the Household has ever logged, taken off the app in one act — complete, raw and unfiltered, because the data belongs to the people who keep it. It is a way *out*, not a way back in: nothing that leaves this way can be loaded back.
_Avoid_: Backup, download, report, dump
