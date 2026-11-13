import { git, type AppDb } from '@skaro/core';
import { CompletionStore } from './completion-store';

const exactObjects = { env: { GIT_NO_REPLACE_OBJECTS: '1' } };

/** Status is not publication evidence; preserve exactly the commit the owner completed. */
export async function publishedCheckout(
  db: AppDb,
  projectId: string,
  root: string,
  head: string,
  base: string,
): Promise<boolean> {
  const included = async (commit: string) =>
    (
      await git(root, ['merge-base', '--is-ancestor', commit, base], {
        ...exactObjects,
        allowFail: true,
      })
    ).code === 0;
  if (await included(head)) return true;
  for (const op of new CompletionStore(db, projectId).operations())
    if (
      op.state === 'completed' &&
      op.commit &&
      op.results.some((r) => r.head === head) &&
      (await included(op.commit))
    )
      return true;
  // Legacy squash receipts can prove the exact tree, never just a matching branch name.
  const tree = (await git(root, ['rev-parse', `${head}^{tree}`], exactObjects)).stdout.trim();
  for (const merge of db.listMerges(projectId)) {
    if (merge.revertCommit || !(await included(merge.commit))) continue;
    if (
      (await git(root, ['rev-parse', `${merge.commit}^{tree}`], exactObjects)).stdout.trim() ===
      tree
    )
      return true;
  }
  return false;
}
