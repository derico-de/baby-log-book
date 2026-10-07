/* pnpm release 1.4.2            commit, tag, push, wait until `docker pull` gets it
   pnpm release 1.4.2 --no-push  commit and tag only, for the sandbox that cannot push
   pnpm release                  push the release already tagged here, then wait */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import {
	githubRepo,
	isNewer,
	parseVersion,
	releaseChangelog,
	setPackageVersion
} from './release-lib.mjs';

const BRANCH = 'main';
const WORKFLOW = 'publish.yml';
const POLL_MS = 15_000;
const TIMEOUT_MS = 30 * 60_000;
const MANIFEST_TYPES = [
	'application/vnd.oci.image.index.v1+json',
	'application/vnd.docker.distribution.manifest.list.v2+json'
].join(', ');
const USAGE = 'usage: pnpm release [<version>] [--no-push]';

/** @param {string[]} args */
function git(...args) {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** @param {string[]} args */
function gitSucceeds(...args) {
	try {
		execFileSync('git', args, { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

/** @param {string} message @returns {never} */
function fail(message) {
	console.error(`release: ${message}`);
	process.exit(1);
}

/** @param {string} version */
function isTagged(version) {
	return gitSucceeds('rev-parse', '--verify', '--quiet', `refs/tags/v${version}`);
}

function assertCleanMain() {
	const branch = git('branch', '--show-current');
	if (branch !== BRANCH) fail(`releases are cut from ${BRANCH}, not ${branch || 'a detached HEAD'}`);
	if (git('status', '--porcelain')) fail('the working tree has uncommitted changes');
}

/** @param {string} current @param {string} version */
function commitAndTag(current, version) {
	if (!isNewer(version, current)) fail(`${version} is not newer than ${current}`);
	if (isTagged(version)) fail(`v${version} already exists`);
	const today = new Date().toISOString().slice(0, 10);
	const changelog = releaseChangelog(readFileSync('CHANGELOG.md', 'utf8'), version, today);
	const packageJson = setPackageVersion(readFileSync('package.json', 'utf8'), version);
	writeFileSync('CHANGELOG.md', changelog);
	writeFileSync('package.json', packageJson);
	git('add', 'CHANGELOG.md', 'package.json');
	git('commit', '--quiet', '-m', `Release ${version}`);
	git('tag', '-a', `v${version}`, '-m', `Release ${version}`);
	console.log(`Committed and tagged v${version}.`);
}

/** @param {string} version */
function push(version) {
	const tag = `v${version}`;
	if (!isTagged(version)) fail(`${tag} is not tagged; cut it with: pnpm release <version>`);
	if (!gitSucceeds('merge-base', '--is-ancestor', tag, 'HEAD')) fail(`${tag} is not on ${BRANCH}`);
	git('fetch', '--quiet', 'origin', BRANCH);
	if (!gitSucceeds('merge-base', '--is-ancestor', `origin/${BRANCH}`, 'HEAD')) {
		fail(`origin/${BRANCH} has commits this checkout lacks; pull, then run again`);
	}
	/* --follow-tags also pushes older releases tagged here but never pushed. The
	   workflow gives :latest to the newest of them whatever order they build in. */
	execFileSync('git', ['push', '--atomic', '--follow-tags', 'origin', BRANCH, `refs/tags/${tag}`], {
		stdio: 'inherit'
	});
}

/** @param {string} name owner/repo, lowercase @param {string[]} tags */
async function digests(name, tags) {
	try {
		const auth = await fetch(`https://ghcr.io/token?scope=repository:${name}:pull`);
		const { token } = await auth.json();
		return await Promise.all(
			tags.map(async (tag) => {
				const manifest = await fetch(`https://ghcr.io/v2/${name}/manifests/${tag}`, {
					method: 'HEAD',
					headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_TYPES }
				});
				return manifest.ok ? manifest.headers.get('docker-content-digest') : null;
			})
		);
	} catch {
		return tags.map(() => null);
	}
}

/** @param {string} repo @param {string} tag */
async function publishRun(repo, tag) {
	const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
	try {
		const response = await fetch(
			`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/runs?branch=${tag}&per_page=1`,
			{
				headers: {
					Accept: 'application/vnd.github+json',
					...(token ? { Authorization: `Bearer ${token}` } : {})
				}
			}
		);
		if (!response.ok) return null;
		return (await response.json()).workflow_runs?.[0] ?? null;
	} catch {
		return null;
	}
}

/** @param {string} repo @param {string} version */
async function waitForImage(repo, version) {
	const name = repo.toLowerCase();
	const [major, minor] = parseVersion(version);
	const shared = ['latest', `${major}`, `${major}.${minor}`];
	console.log(`Waiting until ghcr.io/${name}:latest is ${version}. Ctrl-C is safe; the build carries on.`);
	const deadline = Date.now() + TIMEOUT_MS;
	let lastStatus = '';
	let builtButBehind = false;
	while (Date.now() < deadline) {
		const [released, ...current] = await digests(name, [version, ...shared]);
		const behind = shared.filter((_, i) => !released || current[i] !== released);
		if (behind.length === 0) {
			console.log(`Done: docker pull ghcr.io/${name}:latest gets ${version}.`);
			return;
		}
		const run = await publishRun(repo, `v${version}`);
		if (run && run.status !== lastStatus) {
			console.log(`  build ${run.status}: ${run.html_url}`);
			lastStatus = run.status;
		}
		if (run?.status === 'completed') {
			if (run.conclusion !== 'success') fail(`the build ended in ${run.conclusion}: ${run.html_url}`);
			/* The registry can lag the run by a moment, so look once more. */
			if (builtButBehind) {
				fail(
					`the build passed, but ${behind.map((tag) => `:${tag}`).join(', ')} still point elsewhere. ` +
						`A newer release owns them, or an older build overwrote them; ` +
						`re-run ${run.html_url} to move them to ${version}.`
				);
			}
			builtButBehind = true;
		}
		await sleep(POLL_MS);
	}
	fail(`gave up after ${TIMEOUT_MS / 60_000} minutes; see https://github.com/${repo}/actions`);
}

async function main() {
	const args = process.argv.slice(2);
	const unknown = args.filter((arg) => arg.startsWith('-') && arg !== '--no-push');
	const positional = args.filter((arg) => !arg.startsWith('-'));
	if (unknown.length || positional.length > 1) fail(USAGE);
	const pushing = !args.includes('--no-push');

	assertCleanMain();
	const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
	const version = positional[0]?.replace(/^v/, '') ?? current;
	parseVersion(version);
	if (version !== current) commitAndTag(current, version);
	if (!pushing) {
		console.log('Push it from outside the sandbox with: pnpm release');
		return;
	}
	push(version);
	await waitForImage(githubRepo(git('remote', 'get-url', 'origin')), version);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
