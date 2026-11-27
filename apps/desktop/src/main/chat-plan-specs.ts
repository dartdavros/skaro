import type { Spec } from '@skaro/core';
import { adrId } from './chat-proposal-helpers';

/** A linked specification must still be accepted when the user applies the plan. */
export function planSpecProblem(
  tasks: { title: string; spec?: string }[],
  specs: Spec[],
): string | undefined {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  const invalid = tasks.filter(
    (task) => task.spec && byId.get(adrId(task.spec))?.status !== 'accepted',
  );
  if (invalid.length)
    return (
      `Tasks must reference accepted specifications: ${invalid.map((task) => `${task.title} → SPEC-${adrId(task.spec!)}`).join(', ')}. ` +
      'Use propose_spec in this chat and obtain acceptance, then propose implementation tasks. ' +
      'A milestone may have tasks: []; do not create specification-preparation tasks.'
    );
  return undefined;
}
