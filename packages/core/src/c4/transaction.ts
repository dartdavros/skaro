import { rm } from 'node:fs/promises';
import type { C4Package } from './model.ts';
import { C4_MODEL_PATH } from './model.ts';
import { c4Path, readC4File, withC4Lock, writeC4File } from './io.ts';
import { C4_DOCUMENT_PATH, c4Hash } from './documents.ts';
import { readC4Model } from './shape.ts';

const JOURNAL = 'c4/transaction.json';
interface Transaction {
  version: 1;
  package: C4Package;
  hash: string;
}

export async function c4PackageStatus(
  root: string,
  pkg: C4Package,
): Promise<'applied' | 'writing' | 'unwritten'> {
  const history = await readC4File(root, `c4/history/${pkg.baseRevision + 1}.json`);
  const expected = c4Hash(JSON.stringify(pkg));
  const matches = (raw: string) => {
    const tx = readTransaction(JSON.parse(raw));
    if (tx.package.id !== pkg.id) return false;
    if (tx.hash !== expected)
      throw new Error('C4: persisted package identity has different contents');
    return true;
  };
  if (history && matches(history)) return 'applied';
  const journal = await readC4File(root, JOURNAL);
  return journal && matches(journal) ? 'writing' : 'unwritten';
}

function readTransaction(value: unknown): Transaction {
  const tx = value as Transaction;
  if (
    !tx ||
    tx.version !== 1 ||
    !tx.package ||
    !Array.isArray(tx.package.files) ||
    tx.hash !== c4Hash(JSON.stringify(tx.package))
  )
    throw new Error('C4: damaged transaction journal');
  const paths = new Set<string>();
  const completion = tx.package.completion;
  if (
    completion &&
    (!/^T-\d+$/.test(completion.taskId) ||
      !new RegExp(`^tasks/${completion.taskId}-[a-zA-Z0-9_-]+\\.md$`).test(completion.path))
  )
    throw new Error('C4: invalid internal task completion');
  for (const file of tx.package.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      typeof file.after !== 'string' ||
      (file.before !== null && typeof file.before !== 'string') ||
      (!C4_DOCUMENT_PATH.test(file.path) &&
        file.path !== C4_MODEL_PATH &&
        file.path !== completion?.path) ||
      paths.has(file.path)
    )
      throw new Error('C4: invalid transaction file');
    paths.add(file.path);
  }
  const model = tx.package.files.find((f) => f.path === C4_MODEL_PATH);
  if (completion && !paths.has(completion.path)) throw new Error('C4: completion file missing');
  if (!model || readC4Model(JSON.parse(model.after)).revision !== tx.package.baseRevision + 1)
    throw new Error('C4: invalid transaction revision');
  return tx;
}

/** Roll forward only confirmed writes; conflicts never overwrite independently edited files. */
export async function recoverC4Transaction(root: string): Promise<void> {
  const raw = await readC4File(root, JOURNAL);
  if (raw === null) return;
  const tx = readTransaction(JSON.parse(raw));
  for (const file of tx.package.files) {
    const current = await readC4File(root, file.path);
    if (current !== file.before && current !== file.after)
      throw new Error(
        `C4: recovery blocked by external edit of ${file.path}; restore the confirmed before/after content`,
      );
  }
  // Model last: it is the revision commit marker. Readers hold the same lock.
  for (const file of tx.package.files.filter((f) => f.path !== C4_MODEL_PATH))
    if ((await readC4File(root, file.path)) !== file.after)
      await writeC4File(root, file.path, file.after);
  const model = tx.package.files.find((f) => f.path === C4_MODEL_PATH)!;
  await writeC4File(root, C4_MODEL_PATH, model.after);
  await writeC4File(
    root,
    `c4/history/${tx.package.baseRevision + 1}.json`,
    JSON.stringify(tx, null, 2) + '\n',
  );
  await rm(await c4Path(root, JOURNAL));
}

export async function applyC4Package(root: string, pkg: C4Package): Promise<void> {
  await withC4Lock(root, async () => {
    await recoverC4Transaction(root);
    const history = await readC4File(root, `c4/history/${pkg.baseRevision + 1}.json`);
    if (history) {
      const previous = readTransaction(JSON.parse(history));
      if (previous.package.id === pkg.id && previous.hash === c4Hash(JSON.stringify(pkg))) return;
      throw new Error('C4: this revision was already applied by another package');
    }
    const tx = readTransaction({ version: 1, package: pkg, hash: c4Hash(JSON.stringify(pkg)) });
    for (const file of pkg.files)
      if ((await readC4File(root, file.path)) !== file.before)
        throw new Error(`C4: ${file.path} changed after this proposal; prepare a new package`);
    const current = await readC4File(root, C4_MODEL_PATH);
    const revision = current === null ? 0 : readC4Model(JSON.parse(current)).revision;
    if (revision !== pkg.baseRevision) throw new Error('C4: stale package revision');
    // Persist owner intent before the first artifact write. Rejection never creates a journal.
    await writeC4File(root, JOURNAL, JSON.stringify(tx, null, 2) + '\n');
    await recoverC4Transaction(root);
  });
}
