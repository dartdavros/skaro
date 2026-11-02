import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isLiveBudgetJournal } from '../credentials/live-budget-ledger';

/** Compare real older primary files, not only an aggregate spend counter. */
export async function configuredPlanHistory(directory: string, current: string) {
  const result: { name: string; sha256: string }[] = [];
  for (const name of await readdir(directory))
    if (name !== current && isLiveBudgetJournal(name))
      result.push({
        name,
        sha256: createHash('sha256')
          .update(await readFile(join(directory, name)))
          .digest('hex'),
      });
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
