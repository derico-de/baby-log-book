<script lang="ts">
	/* The Household Zone suggestion, where the times are (ADR-0048).

	   Until the Household moves, every clock face on the timeline and every
	   time a sheet prefills is the old zone's, an hour or more off the phone in
	   the hand. Tucked away in Settings, it read as the app being wrong. Here it
	   says why, once, and either answer makes it go away. */
	import { app } from '$client/state.svelte';
	import { zoneName } from '$lib/i18n/format';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		zone: string;
	}
	let { zone }: Props = $props();

	const here = $derived(zoneName(zone));
	const household = $derived(zoneName(app.zone));
</script>

<div class="banner" role="region" aria-label={m.zone_banner_title({ zone: here })}>
	<div class="banner-q">{m.zone_banner_title({ zone: here })}</div>
	<div class="banner-sub">{m.zone_banner_sub({ zone: here, household })}</div>
	<div class="banner-acts">
		<button type="button" data-primary="1" onclick={() => void app.moveToSuggestedZone()}>
			{m.settings_zone_suggest_move()}
		</button>
		<button type="button" onclick={() => void app.dismissZoneSuggestion()}>
			{m.settings_zone_suggest_keep({ zone: household })}
		</button>
	</div>
</div>
