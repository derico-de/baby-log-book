<script lang="ts" module>
	/* The glyph set. A stroke-1.7 geometric family, legible at 19px in a dark
	   room (spec §8.1). Entry types are told apart by glyph and label, never by
	   colour — which is why a seventh type cost one glyph and nothing else.

	   The Milestone glyph is a flag: literally the marker on a milestone, and
	   nothing else in the set of seven is that shape. (Star reads as *favourite*;
	   sparkle blurs at stroke 1.7; footprint is organic in a geometric family;
	   trophy imports a competitive tone.) */
	export const ICONS = {
		feed: 'M8 2h8M9 2v3.2a4 4 0 0 1-.6 2.1L7.6 8.6A4 4 0 0 0 7 10.7V19a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3v-8.3a4 4 0 0 0-.6-2.1l-.8-1.3A4 4 0 0 1 15 5.2V2|M7 13h10',
		sleep: 'M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z',
		nappy: 'M4 5h16v5a10 10 0 0 1-8 9.8A10 10 0 0 1 4 10Z|M9 12.5c1.2 1 4.8 1 6 0',
		meal: 'M3.5 10.5h17a8.5 8.5 0 0 1-8.5 8.5 8.5 8.5 0 0 1-8.5-8.5Z|M8 6.5c0-1.2 1-1.6 1-2.5M12 6c0-1.4 1-1.8 1-2.8M16 6.5c0-1.2 1-1.6 1-2.5',
		measure: 'M3 8h18v8H3Z|M7 8v3M11 8v4M15 8v3M19 8v4',
		flag: 'M5 21V4|M5 4.5h11l-2 3.5 2 3.5H5',
		note: 'M4 6h16M4 12h16M4 18h9',
		plus: 'M12 5v14M5 12h14',
		stats: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
		gear: 'M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3',
		home: 'M4 10.5 12 4l8 6.5V20H4Z|M9.5 20v-6h5v6',
		search: 'M15.5 15.5 21 21',
		x: 'M6 6l12 12M18 6 6 18',
		back: 'M15 5l-7 7 7 7',
		chev: 'M9 5l7 7-7 7',
		sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8',
		check: 'M4 12.5 9 17.5 20 6.5',
		clock: 'M12 7v5l3.5 2',
		download: 'M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14'
	} as const;

	export type IconName = keyof typeof ICONS;

	/* A few glyphs need a circle, which a path cannot cheaply fake at this
	   stroke width. */
	const CIRCLES: Partial<Record<IconName, Array<[number, number, number]>>> = {
		gear: [[12, 12, 3]],
		search: [[10.5, 10.5, 6.5]],
		sliders: [
			[16, 7, 2],
			[10, 17, 2]
		],
		clock: [[12, 12, 8.5]]
	};

	export function iconPaths(name: IconName): string[] {
		return ICONS[name].split('|');
	}

	export function iconCircles(name: IconName): Array<[number, number, number]> {
		return CIRCLES[name] ?? [];
	}
</script>

<script lang="ts">
	interface Props {
		name: IconName;
		size?: number;
	}
	let { name, size }: Props = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.7"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	style={size ? `width:${size}px;height:${size}px` : undefined}
>
	{#each iconCircles(name) as [cx, cy, r] (`${cx}-${cy}-${r}`)}
		<circle {cx} {cy} {r} />
	{/each}
	{#each iconPaths(name) as d (d)}
		<path {d} />
	{/each}
</svg>
