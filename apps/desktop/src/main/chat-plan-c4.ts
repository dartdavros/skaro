import { dirname } from 'node:path';
import type { AppDb } from '@skaro/core';
import { background } from './background/client';
import type { C4ProposalRecord } from './c4-service';
import { adrId } from './chat-proposal-helpers';

interface PlanTask {
  spec?: string;
  body?: string;
  notes?: string;
  goal?: string;
  criteria?: string[];
}

/** An accepted old specification does not approve a pending replacement. */
export function unresolvedPlanPackages(tasks: PlanTask[], records: C4ProposalRecord[]): string[] {
  const specs = new Set(tasks.flatMap((task) => (task.spec ? [adrId(task.spec)] : [])));
  const references = new Set(
    tasks.flatMap(
      (task) =>
        [task.body, task.notes, task.goal, ...(task.criteria ?? [])]
          .join('\n')
          .toLowerCase()
          .match(/\bskaro-c4-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/g) ?? [],
    ),
  );
  return records
    .filter(({ item, package: pkg, fileIndex }) => {
      if (references.has(item.id)) return item.state !== 'applied';
      if (!['pending', 'accepted'].includes(item.state)) return false;
      return (fileIndex ?? pkg.files).some(({ path }) => {
        const id = /^specs\/(\d{4})(?:-|\.md$)/.exec(path)?.[1];
        return id !== undefined && specs.has(id);
      });
    })
    .map(({ item }) => item.id);
}

export async function pendingC4PlanProblem(
  db: Pick<AppDb, 'filePath'>,
  projectId: string,
  tasks: PlanTask[],
): Promise<string | undefined> {
  if (!tasks.length) return undefined;
  const records = await background(dirname(db.filePath), 'c4.list', projectId);
  const pending = unresolvedPlanPackages(tasks, records);
  if (pending.length)
    return (
      `C4 packages required by this plan are not applied: ${pending.join(', ')}. ` +
      'Keep the saved plan; read get_c4_context and resolve these dependencies before retrying. ' +
      'Confirming a task plan does not accept architecture packages.'
    );
  return undefined;
}
