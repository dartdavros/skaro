import { git, validateC4Code, type C4Model } from '@skaro/core';

/** Only facts introduced on the base after branching can wait for candidate validation. */
export function deferBaseOnlyPath(
  path: string,
  base: Set<string>,
  ancestor: Set<string>,
  head: Set<string>,
  changed: Set<string>,
): boolean {
  return base.has(path) && !ancestor.has(path) && !head.has(path) && !changed.has(path);
}

/** Publication still checks the complete model against the assembled candidate. */
export async function validateC4TaskCode(
  root: string,
  baseHead: string,
  model: C4Model,
  changedFiles: string[],
  realizedIds: string[],
): Promise<string[]> {
  const ancestor = (await git(root, ['merge-base', baseHead, 'HEAD'])).stdout.trim();
  const trees = await Promise.all(
    [baseHead, ancestor, 'HEAD'].map(async (ref) => {
      const result = await git(root, ['ls-tree', '-r', '--name-only', '-z', ref]);
      return new Set(result.stdout.split('\0').filter(Boolean));
    }),
  );
  const changed = new Set(changedFiles);
  return validateC4Code(root, {
    ...model,
    elements: model.elements.map((element) => ({
      ...element,
      code: realizedIds.includes(element.id)
        ? element.code
        : element.code.filter(
            (path) => !deferBaseOnlyPath(path, trees[0]!, trees[1]!, trees[2]!, changed),
          ),
    })),
  });
}
