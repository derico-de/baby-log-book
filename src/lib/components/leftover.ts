/* The leftover inputs' shared DOM glue (ADR-0018), used by the feed sheet and
   the entry edit sheet alike: read the confirmed value, clear the input —
   kept filled it would invite a second application and a double subtraction —
   and hand back what the Intake field should now hold. Never stored. */

import { subtractLeftover } from '$domain/entries';

export function applyLeftoverInput(event: Event, intake: number | null): number | null {
	const input = event.currentTarget as HTMLInputElement;
	const value = input.valueAsNumber;
	input.value = '';
	if (!Number.isFinite(value) || value <= 0) return intake;
	return subtractLeftover(intake, value);
}
