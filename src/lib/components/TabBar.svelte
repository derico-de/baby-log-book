<script lang="ts">
	/* Three destinations, and a bottom tab bar: Timeline · Stats · Settings.

	   It does put a second control in the thumb zone, which is the trade the
	   constraint warned about — but it is a wide, shallow strip under a 62px FAB
	   at bottom: 76px with 14px of clear space, so the two are never mistaken for
	   one another, and it is the only option that shows where you are without
	   being opened (spec §8.3). */
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import * as m from '$lib/paraglide/messages';

	const tabs = [
		{ href: '/', icon: 'home' as const, label: () => m.nav_timeline() },
		{ href: '/stats', icon: 'stats' as const, label: () => m.nav_stats() },
		{ href: '/settings', icon: 'gear' as const, label: () => m.nav_settings() }
	];

	const current = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

<nav class="tabbar" aria-label={m.app_name()}>
	{#each tabs as tab (tab.href)}
		<a href={tab.href} aria-current={current(tab.href) ? 'page' : undefined}>
			<Icon name={tab.icon} />
			<span>{tab.label()}</span>
		</a>
	{/each}
</nav>
