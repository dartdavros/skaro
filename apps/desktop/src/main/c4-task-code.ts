import { git, inspectC4Code, type C4Model, type C4Issue } from '@skaro/core';

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
  return (await inspectC4TaskCode(root, baseHead, model, changedFiles, realizedIds)).map(
    (issue) => issue.message,
  );
}

export async function inspectC4TaskCode(
  root: string,
  baseHead: string,
  model: C4Model,
  changedFiles: string[],
  realizedIds: string[],
): Promise<C4Issue[]> {
  const ancestor = (await git(root, ['merge-base', baseHead, 'HEAD'])).stdout.trim();
  const trees = await Promise.all(
    [baseHead, ancestor, 'HEAD'].map(async (ref) => {
      const result = await git(root, ['ls-tree', '-r', '--name-only', '-z', ref]);
      return new Set(result.stdout.split('\0').filter(Boolean));
    }),
  );
  const changed = new Set(changedFiles);
  return inspectC4Code(root, {
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
