<script lang="ts">
	/* Settings. Spec §6, §7, §9.2, §9.3, §9.4.

	   Every control on this screen is Pico as shipped: the override budget is spent
	   on components Pico does not have, not on fighting the ones it does (spec
	   §8.2). */
	import { goto } from '$app/navigation';
	import { app } from '$client/state.svelte';
	import {
		addBaby,
		removeFood,
		removeMember,
		renameFood,
		setDayStart,
		setHouseholdZone,
		setMemberLocale,
		setMemberRole,
		setTarget,
		updateBaby
	} from '$client/mutate';
	import { resetReplica } from '$client/db';
	import { buildExportZip, saveBlob } from '$client/export';
	import {
		appearanceOverride,
		deviceZone,
		setAppearanceOverride,
		type AppearanceOverride
	} from '$client/device';
	import { canPromptInstall, isStandalone, promptInstall } from '$client/pwa';
	import { ANCHOR_FOR, bottleTargetOf, typicalFor } from '$domain/targets';
	import { ageInMonths } from '$domain/time';
	import { EMPTY_FILTER } from '$domain/filter';
	import { LOCALE_NAMES, LOCALES, switchLocale } from '$lib/i18n/locale.svelte';
	import { dateAndTime, plural, targetDuration } from '$lib/i18n/format';
	import type { Activity } from '$domain/types';
	import type { Locale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';
	import Icon from '$lib/components/Icon.svelte';
	import Notices from '$lib/components/Notices.svelte';
	import { activeLocale } from '$lib/i18n/locale.svelte';

	interface PendingInvite {
		display_name: string;
		role: 'parent' | 'caregiver';
		created_at: number;
		expires_at: number;
		handle: string;
	}

	let appearance = $state<AppearanceOverride>('auto');
	let invites = $state<PendingInvite[]>([]);
	let inviteName = $state('');
	let inviteRole = $state<'parent' | 'caregiver'>('caregiver');
	let mintedUrl = $state<string | null>(null);
	let mintedName = $state('');
	let copied = $state(false);
	let exporting = $state(false);
	let resetNote = $state<string | null>(null);
	let newBabyName = $state('');
	let newBabyBirth = $state('');
	let installed = $state(false);

	const baby = $derived(app.baby);
	const household = $derived(app.household);
	const isParent = $derived(app.isParent);
	const version = $derived(app.sync.version);

	const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
	const gitSha = typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : 'unknown';

	$effect(() => {
		appearance = appearanceOverride();
		installed = isStandalone();
		if (isParent) void loadInvites();
	});

	async function loadInvites() {
		try {
			const response = await fetch('/api/invites');
			if (!response.ok) return;
			const body = (await response.json()) as { invites: PendingInvite[] };
			invites = body.invites;
		} catch {
			/* Offline: the pending list is a server thing, and its absence is not an
			   error worth shouting about. */
		}
	}

	async function createInvite(event: SubmitEvent) {
		event.preventDefault();
		const name = inviteName.trim();
		if (name.length === 0) return;
		const response = await fetch('/api/invites', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ display_name: name, role: inviteRole })
		});
		if (!response.ok) return;
		const body = (await response.json()) as { url: string };
		mintedUrl = body.url;
		mintedName = name;
		inviteName = '';
		copied = false;
		await loadInvites();
	}

	async function revokeInvite(handle: string) {
		await fetch(`/api/invites?handle=${encodeURIComponent(handle)}`, { method: 'DELETE' });
		await loadInvites();
	}

	async function copyInvite() {
		if (!mintedUrl) return;
		try {
			await navigator.clipboard.writeText(mintedUrl);
			copied = true;
		} catch {
			copied = false;
		}
	}

	/** A Target is a duration; these two inputs are hours and minutes of it.

	    The Bottle Life falls back to its seeded value rather than to zero, so a
	    Baby added before the field existed shows the hour her countdown is
	    already running against instead of a blank pair of boxes. */
	function targetParts(activity: Activity): { hours: number; minutes: number; id: string | null } {
		const stored = app.babyTargets.find((t) => t.activity === activity);
		const target = stored ?? (activity === 'bottle' && baby ? bottleTargetOf([], baby.id) : null);
		if (!target) return { hours: 0, minutes: 0, id: null };
		return {
			hours: Math.floor(target.duration_s / 3600),
			minutes: Math.round((target.duration_s % 3600) / 60),
			id: stored?.id ?? null
		};
	}

	async function saveTarget(activity: Activity, hours: number, minutes: number) {
		if (!baby) return;
		const seconds = Math.max(0, hours) * 3600 + Math.max(0, minutes) * 60;
		if (seconds <= 0) return;
		const existing = app.babyTargets.find((t) => t.activity === activity);
		await app.edit((w) =>
			setTarget(w, {
				id: existing?.id,
				babyId: baby.id,
				activity,
				durationS: seconds,
				anchor: existing?.anchor ?? ANCHOR_FOR[activity]
			})
		);
	}

	const ageMonths = $derived(baby ? ageInMonths(baby.birth_date, app.now, app.zone) : 0);
	const typicalFeed = $derived(typicalFor('feed', ageMonths));
	const typicalWake = $derived(typicalFor('sleep', ageMonths));
	const ageLabel = $derived(
		ageMonths === 0
			? m.age_newborn()
			: plural(ageMonths, { one: m.age_months_one, few: m.age_months_few, other: m.age_months_other })
	);

	async function runExport() {
		const db = app.dbRef;
		if (!db || exporting) return;
		exporting = true;
		const result = await buildExportZip(db, Date.now());
		exporting = false;
		if (result) saveBlob(result.blob, result.filename);
	}

	async function runReset() {
		const db = app.dbRef;
		if (!db) return;
		const result = await resetReplica(db);
		if (!result.ok) {
			resetNote = m.settings_reset_waiting({ count: result.waiting });
			return;
		}
		resetNote = null;
		await app.refresh();
		app.syncNow();
	}

	async function signOut() {
		const waiting = await app.outboxCount();
		/* Explicit sign-out with a non-empty outbox warns before clearing
		   anything (spec §5.7). */
		if (waiting > 0 && !confirm(m.settings_signout_warn({ count: waiting }))) return;
		await fetch('/api/session', { method: 'DELETE' });
		location.reload();
	}

	async function removeThem(id: string, name: string) {
		if (!confirm(m.settings_member_remove_confirm({ name }))) return;
		await app.edit((w) => removeMember(w, id));
	}

	function showFood(id: string) {
		/* The Food detail view is a pre-filtered timeline, not a screen. */
		app.filter = { ...EMPTY_FILTER, foodId: id };
		void goto('/');
	}
</script>

<section class="screen">
	<header class="head">
		<div class="head-top">
			<h1 class="screen-title">{m.settings_title()}</h1>
		</div>
	</header>

	<Notices />

	<div class="scroll">
		<div class="settings">
			{#if household}
				<section>
					<h3>{m.settings_day()}</h3>
					<label>
						{m.settings_day_start()}
						<input
							type="time"
							value={household.day_start}
							disabled={!isParent}
							onchange={(event) => void app.edit((w) => setDayStart(w, event.currentTarget.value))}
						/>
					</label>
					<!-- Changing it re-buckets the past, and this says so before saving. -->
					<small class="hint">{m.settings_day_start_hint()}</small>

					<label>
						{m.settings_zone()}
						<input
							type="text"
							value={household.zone}
							disabled={!isParent}
							onchange={(event) => void app.edit((w) => setHouseholdZone(w, event.currentTarget.value))}
						/>
					</label>
					<small class="hint">{m.settings_zone_hint()}</small>

					{#if app.zoneSuggestion && isParent}
						<!-- Suggested, never applied: a layover must not move a Household. -->
						<p class="notice">
							{m.settings_zone_suggest({ zone: app.zoneSuggestion })}
							<button
								type="button"
								onclick={async () => {
									const zone = app.zoneSuggestion;
									if (zone) await app.edit((w) => setHouseholdZone(w, zone));
									await app.dismissZoneSuggestion();
								}}>{m.settings_zone_suggest_move()}</button
							>
							<button type="button" onclick={() => void app.dismissZoneSuggestion()}>
								{m.settings_zone_suggest_keep({ zone: household.zone })}
							</button>
						</p>
					{/if}
				</section>
			{/if}

			{#if baby}
				<section>
					<h3>{m.settings_targets({ name: baby.name })}</h3>
					<div class="pair">
						{#each [['feed', m.settings_feed_interval()], ['sleep', m.settings_wake_window()], ['bottle', m.settings_bottle_life()]] as [activity, label] (activity)}
							{@const parts = targetParts(activity as Activity)}
							<label>
								{label}
								<span class="target">
									<input
										type="number"
										min="0"
										max="12"
										value={parts.hours}
										disabled={!isParent}
										onchange={(event) =>
											void saveTarget(activity as Activity, Number(event.currentTarget.value), parts.minutes)}
									/>
									<span>h</span>
									<input
										type="number"
										min="0"
										max="59"
										step="5"
										value={parts.minutes}
										disabled={!isParent}
										onchange={(event) =>
											void saveTarget(activity as Activity, parts.hours, Number(event.currentTarget.value))}
									/>
									<span>m</span>
								</span>
							</label>
						{/each}
					</div>
					<!-- A static hint beside the field: no state, no dismissal flag to
					     sync, and never on the home screen (ADR-0006). -->
					<small class="hint">
						{typicalFeed != null
							? m.settings_typical({
									age: ageLabel,
									feed: targetDuration(typicalFeed),
									wake: targetDuration(typicalWake ?? 0)
								})
							: m.settings_typical_wake({ age: ageLabel, wake: targetDuration(typicalWake ?? 0) })}
					</small>
					<!-- The honest limitation, stated where the number is typed. The
					     countdown starts at the Feed, not at the kettle, so it can only
					     ever read younger than the milk (ADR-0016). -->
					<small class="hint">{m.settings_bottle_life_hint()}</small>
				</section>
			{/if}

			<section>
				<h3>{m.settings_appearance()}</h3>
				<fieldset>
					{#each [['auto', m.settings_appearance_auto()], ['day', m.settings_appearance_day()], ['night', m.settings_appearance_night()]] as [value, label] (value)}
						<label>
							<input
								type="radio"
								name="appearance"
								checked={appearance === value}
								onchange={() => {
									appearance = value as AppearanceOverride;
									setAppearanceOverride(appearance);
								}}
							/>
							{label}
						</label>
					{/each}
				</fieldset>
				<small class="hint">{m.settings_appearance_hint()}</small>

				<label>
					{m.settings_language()}
					<select
						value={activeLocale()}
						onchange={(event) => {
							const next = event.currentTarget.value as Locale;
							switchLocale(next);
							const me = app.identity?.memberId;
							if (me) void app.edit((w) => setMemberLocale(w, me, next));
						}}
					>
						{#each LOCALES as locale (locale)}
							<option value={locale}>{LOCALE_NAMES[locale] ?? locale}</option>
						{/each}
					</select>
				</label>
			</section>

			<section>
				<h3>{m.settings_babies()}</h3>
				{#each app.liveBabies as child (child.id)}
					<div class="pair">
						<label>
							{m.settings_baby_name()}
							<input
								type="text"
								value={child.name}
								disabled={!isParent}
								onchange={(event) => void app.edit((w) => updateBaby(w, child.id, { name: event.currentTarget.value }))}
							/>
						</label>
						<label>
							{m.settings_baby_birth()}
							<input
								type="date"
								value={child.birth_date}
								disabled={!isParent}
								onchange={(event) =>
									void app.edit((w) => updateBaby(w, child.id, { birth_date: event.currentTarget.value }))}
							/>
						</label>
					</div>
				{/each}
				{#if isParent}
					<form
						onsubmit={async (event) => {
							event.preventDefault();
							if (newBabyName.trim().length === 0 || newBabyBirth === '') return;
							await app.edit((w) => addBaby(w, newBabyName.trim(), newBabyBirth));
							newBabyName = '';
							newBabyBirth = '';
						}}
					>
						<div class="pair">
							<label>
								{m.settings_baby_name()}
								<input type="text" bind:value={newBabyName} />
							</label>
							<label>
								{m.settings_baby_birth()}
								<input type="date" bind:value={newBabyBirth} />
							</label>
						</div>
						<button type="submit" class="secondary">{m.timeline_add_baby()}</button>
					</form>
				{/if}
			</section>

			<section>
				<h3>{m.settings_members()}</h3>
				<ul class="members">
					{#each app.members as member (member.id)}
						<li>
							<span>
								{member.display_name}
								<span class="role">
									· {member.role === 'parent' ? m.settings_role_parent() : m.settings_role_caregiver()}
									{#if member.removed_at != null}· {m.settings_removed()}{/if}
									{#if member.id === app.identity?.memberId}· {m.settings_this_device()}{/if}
								</span>
							</span>
							{#if isParent && member.removed_at == null && member.id !== app.identity?.memberId}
								<span class="member-acts">
									<button
										type="button"
										class="secondary"
										onclick={() =>
											void app.edit((w) => setMemberRole(w, member.id, member.role === 'parent' ? 'caregiver' : 'parent'))}
									>
										{member.role === 'parent' ? m.settings_member_demote() : m.settings_member_promote()}
									</button>
									<button type="button" class="secondary" onclick={() => void removeThem(member.id, member.display_name)}>
										{m.settings_member_remove()}
									</button>
								</span>
							{/if}
						</li>
					{/each}
				</ul>
				<!-- One hard rule, and the server enforces it too. -->
				<small class="hint">{m.settings_last_parent()}</small>

				{#if isParent}
					<h3>{m.settings_invite()}</h3>
					<form onsubmit={createInvite}>
						<div class="pair">
							<label>
								{m.settings_invite_name()}
								<input type="text" bind:value={inviteName} />
							</label>
							<label>
								{m.settings_invite_role()}
								<select bind:value={inviteRole}>
									<option value="caregiver">{m.settings_role_caregiver()}</option>
									<option value="parent">{m.settings_role_parent()}</option>
								</select>
							</label>
						</div>
						<button type="submit" class="secondary">{m.settings_invite_create()}</button>
					</form>

					{#if mintedUrl}
						<p class="minted">
							{m.settings_invite_explain({ name: mintedName })}
							<code>{mintedUrl}</code>
							<button type="button" onclick={copyInvite}>
								{copied ? m.settings_invite_copied() : m.settings_invite_copy()}
							</button>
						</p>
					{/if}

					{#if invites.length > 0}
						<h3>{m.settings_invite_pending()}</h3>
						<ul class="members">
							{#each invites as invite (invite.handle)}
								<li>
									<span>
										{invite.display_name}
										<span class="role">· {m.settings_invite_expires({ when: dateAndTime(invite.expires_at, app.zone) })}</span>
									</span>
									<button type="button" class="secondary" onclick={() => void revokeInvite(invite.handle)}>
										{m.settings_invite_revoke()}
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</section>

			{#if app.liveFoods.length > 0}
				<section>
					<h3>{m.settings_foods()}</h3>
					<small class="hint">{m.settings_foods_hint()}</small>
					<ul class="members">
						{#each app.liveFoods as food (food.id)}
							<li>
								<button type="button" class="food-link" onclick={() => showFood(food.id)}>
									{food.name}
									<Icon name="chev" />
								</button>
								{#if isParent}
									<span class="member-acts">
										<button
											type="button"
											class="secondary"
											onclick={() => {
												const name = prompt(m.settings_baby_name(), food.name);
												if (name && name.trim()) void app.edit((w) => renameFood(w, food.id, name.trim()));
											}}>{m.edit()}</button
										>
										<button type="button" class="secondary" onclick={() => void app.edit((w) => removeFood(w, food.id))}>
											{m.delete()}
										</button>
									</span>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section>
				<h3>{m.settings_export()}</h3>
				<small class="hint">{m.settings_export_hint()}</small>
				<button type="button" onclick={runExport} disabled={exporting}>
					<Icon name="download" />
					{exporting ? m.settings_export_working() : m.settings_export_run()}
				</button>
			</section>

			<section>
				<h3>{m.settings_data()}</h3>

				{#if !installed}
					<!-- Settings owns the install permanently; the banner is only a nudge.
					     The row must handle not having a beforeinstallprompt in hand — the
					     event does not survive a reload — by falling back to the
					     instruction rather than rendering a dead button (spec §9.3). -->
					<small class="hint">{m.settings_install_hint()}</small>
					{#if canPromptInstall()}
						<button type="button" onclick={() => void promptInstall()}>{m.settings_install()}</button>
					{:else}
						<p class="hint">{m.settings_install_ios()}</p>
					{/if}
				{/if}

				<h3>{m.settings_reset()}</h3>
				<small class="hint">{m.settings_reset_hint()}</small>
				{#if resetNote}<p class="hint">{resetNote}</p>{/if}
				<button type="button" class="secondary" onclick={runReset}>{m.settings_reset_run()}</button>

				<h3>{m.settings_signout()}</h3>
				<button type="button" class="secondary" onclick={signOut}>{m.settings_signout()}</button>
			</section>

			<section>
				<!-- One version line, splitting into two only when client and server
				     disagree. One line is what AGPL §13 needs and what a bug report
				     needs; the disagreement is the single most useful fact in any bug
				     report this project will receive. -->
				<p class="version">
					{version && (version.app_version !== appVersion || version.git_sha !== gitSha)
						? m.settings_version_split({
								app: appVersion,
								sha: gitSha,
								serverApp: version.app_version,
								serverSha: version.git_sha
							})
						: m.settings_version({ app: appVersion, sha: gitSha })}
					·
					<a href={version?.source || 'https://github.com/MrTango/baby-log-book'} rel="noreferrer">
						{m.settings_source()}
					</a>
				</p>
				<p class="version">{deviceZone()}</p>
			</section>
		</div>
		<div class="pad-bottom"></div>
	</div>
</section>

<style>
	.target {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}
	.target input {
		margin: 0;
	}
	.member-acts {
		display: flex;
		gap: var(--sp-2);
		flex: none;
	}
	.member-acts button {
		margin: 0;
		padding: 6px 10px;
		font-size: var(--fs-1);
	}
	.food-link {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		background: none;
		border: 0;
		padding: 0;
		margin: 0;
		color: var(--ink);
		font-size: var(--fs-2);
		cursor: pointer;
		width: auto;
	}
	.food-link :global(svg) {
		width: 15px;
		height: 15px;
		color: var(--ink-3);
	}
	.minted code {
		display: block;
		overflow-wrap: anywhere;
		margin: var(--sp-2) 0;
	}
</style>
