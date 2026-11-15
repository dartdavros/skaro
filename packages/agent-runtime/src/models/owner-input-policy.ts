import type { UserInput } from '@skaro/timeline';

/** A context update narrows existing execution; it never authorizes a fresh owner turn. */
export function ownerInputDisposition(
  input: UserInput,
  mode: 'send' | 'steer',
  active: boolean,
  sealed: boolean,
): 'skip' | 'steer' | 'start' | 'wait' | 'busy' {
  if (input.onlyActiveTurn) return active && !sealed ? 'steer' : 'skip';
  if (!active) return 'start';
  if (mode === 'send') return 'busy';
  return sealed ? 'wait' : 'steer';
}
