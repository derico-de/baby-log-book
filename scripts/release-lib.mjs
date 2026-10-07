/* The text edits of a release, apart from release.mjs's git and network calls. */

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;
const UNRELEASED = '## [Unreleased]\n';

/** @param {string} version @returns {number[]} */
export function parseVersion(version) {
	const match = RELEASE.exec(version);
	if (!match) throw new Error(`"${version}" is not a version like 1.4.2`);
	return match.slice(1).map(Number);
}

/** @param {string} a @param {string} b */
export function isNewer(a, b) {
	const [x, y] = [parseVersion(a), parseVersion(b)];
	const differs = x.findIndex((part, i) => part !== y[i]);
	return differs !== -1 && x[differs] > y[differs];
}

/** @param {string} changelog @param {string} version @param {string} date */
export function releaseChangelog(changelog, version, date) {
	if (changelog.includes(`## [${version}]`)) {
		throw new Error(`CHANGELOG.md already has a section for ${version}`);
	}
	const start = changelog.indexOf(UNRELEASED);
	if (start === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
	const bodyStart = start + UNRELEASED.length;
	const nextSection = changelog.indexOf('\n## ', bodyStart);
	const rest = changelog.slice(bodyStart);
	const body = nextSection === -1 ? rest : changelog.slice(bodyStart, nextSection);
	if (!body.trim()) throw new Error('CHANGELOG.md has nothing under Unreleased to release');
	return `${changelog.slice(0, bodyStart)}\n## [${version}] - ${date}\n\n${rest.trimStart()}`;
}

/** @param {string} packageJson @param {string} version */
export function setPackageVersion(packageJson, version) {
	const field = /("version"\s*:\s*")[^"]*(")/;
	if (!field.test(packageJson)) throw new Error('package.json has no "version" field');
	return packageJson.replace(field, `$1${version}$2`);
}

/** @param {string} remoteUrl @returns {string} owner/name */
export function githubRepo(remoteUrl) {
	const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remoteUrl);
	if (!match) throw new Error(`origin (${remoteUrl}) is not a GitHub repository`);
	return `${match[1]}/${match[2]}`;
}
