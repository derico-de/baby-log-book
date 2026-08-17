/* The Export, produced in the browser. ADR-0007, spec §9.2.

   From the local replica as a Blob: it works offline, needs no endpoint and no
   auth path, and at 2 MB a year the server's only advantage never gets cashed in.
   It also keeps the export honest — what comes out is exactly what your Device
   holds. */

import { zipSync, strToU8 } from 'fflate';
import { buildExport, exportFileName } from '$domain/export';
import type { ReplicaDb } from './db';

const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
const GIT_SHA = typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : 'unknown';

export interface ExportResult {
	blob: Blob;
	filename: string;
	bytes: number;
}

export async function buildExportZip(db: ReplicaDb, now: number): Promise<ExportResult | null> {
	const [households, babies, members, foods, targets, entries, revisions] = await Promise.all([
		db.households.toArray(),
		db.babies.toArray(),
		db.members.toArray(),
		db.foods.toArray(),
		db.targets.toArray(),
		db.entries.toArray(),
		db.revisions.toArray()
	]);
	const household = households[0];
	if (!household) return null;

	/* Everything, always, no options: one button, all Babies, all time, the whole
	   Household. A filtered export is not an escape hatch. */
	const files = buildExport({
		household,
		babies,
		members,
		foods,
		targets,
		entries,
		revisions,
		exportedAt: now,
		appVersion: APP_VERSION,
		gitSha: GIT_SHA
	});

	const packed = zipSync(
		Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])),
		{ level: 6 }
	);

	const blob = new Blob([packed as unknown as BlobPart], { type: 'application/zip' });
	return { blob, filename: exportFileName(now, household.zone), bytes: blob.size };
}

/** Hands the file to the browser. Nothing here talks to the server. */
export function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	/* Revoked on the next tick, so Safari has had time to start the download. */
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
