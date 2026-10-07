import { describe, expect, it } from 'vitest';
import {
	githubRepo,
	isNewer,
	parseVersion,
	releaseChangelog,
	setPackageVersion
} from './release-lib.mjs';

const changelog = `# Changelog

Intro.

## [Unreleased]

### Changed

- The bar reads \`50m\`.

## [1.39.0] - 2026-10-06

### Changed

- Older entry.
`;

describe('releaseChangelog', () => {
	it('moves the Unreleased entries under the new version, leaving Unreleased empty', () => {
		expect(releaseChangelog(changelog, '1.40.0', '2026-10-07')).toBe(`# Changelog

Intro.

## [Unreleased]

## [1.40.0] - 2026-10-07

### Changed

- The bar reads \`50m\`.

## [1.39.0] - 2026-10-06

### Changed

- Older entry.
`);
	});

	it('refuses a release with nothing under Unreleased', () => {
		const empty = releaseChangelog(changelog, '1.40.0', '2026-10-07');
		expect(() => releaseChangelog(empty, '1.41.0', '2026-10-07')).toThrow(/nothing under Unreleased/);
	});

	it('refuses a version the changelog already has', () => {
		expect(() => releaseChangelog(changelog, '1.39.0', '2026-10-07')).toThrow(/already/);
	});
});

describe('setPackageVersion', () => {
	it('changes only the version field and keeps the formatting', () => {
		const pkg = '{\n\t"name": "baby-log-book",\n\t"version": "1.39.0",\n\t"type": "module"\n}\n';
		expect(setPackageVersion(pkg, '1.40.0')).toBe(
			'{\n\t"name": "baby-log-book",\n\t"version": "1.40.0",\n\t"type": "module"\n}\n'
		);
	});
});

describe('versions', () => {
	it('compares numerically, not as text', () => {
		expect(isNewer('1.10.0', '1.9.0')).toBe(true);
		expect(isNewer('1.40.0', '1.40.0')).toBe(false);
		expect(isNewer('1.39.1', '1.40.0')).toBe(false);
	});

	it('accepts only plain major.minor.patch', () => {
		expect(parseVersion('1.40.0')).toEqual([1, 40, 0]);
		expect(() => parseVersion('1.40')).toThrow();
		expect(() => parseVersion('v1.40.0')).toThrow();
		expect(() => parseVersion('1.40.0-rc.1')).toThrow();
	});
});

describe('githubRepo', () => {
	it.each([
		'git@github.com:derico-de/baby-log-book.git',
		'https://github.com/derico-de/baby-log-book.git',
		'https://github.com/derico-de/baby-log-book',
		'ssh://git@github.com/derico-de/baby-log-book.git'
	])('reads owner/name from %s', (url) => {
		expect(githubRepo(url)).toBe('derico-de/baby-log-book');
	});

	it('refuses a remote that is not on GitHub', () => {
		expect(() => githubRepo('git@gitlab.com:someone/thing.git')).toThrow(/not a GitHub/);
	});
});
