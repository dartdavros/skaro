import {
  git,
  realizeC4,
  inspectC4Code,
  inspectC4Model,
  C4ValidationError,
  c4Issue,
  type C4Model,
  type C4Issue,
} from '@skaro/core';

/** A deterministic architecture failure needs a changed candidate, never a publication retry. */
export class C4PublicationError extends C4ValidationError {
  constructor(issues: C4Issue[]) {
    super(issues, 'publication');
  }
}

export interface C4Candidate {
  root: string;
  base: string;
  /** Omitted only while publication has assembled its staged tree. */
  head?: string;
  staged?: boolean;
}

/** Preserve element identity and semantics; follow only renames actually detected by Git. */
export async function candidateC4Model(
  model: C4Model,
  realized: string[],
  candidate?: C4Candidate,
): Promise<C4Model> {
  let next: C4Model;
  try {
    next = realized.length ? realizeC4(model, realized) : structuredClone(model);
  } catch (error) {
    if (error instanceof C4ValidationError) throw new C4PublicationError(error.diagnostic.issues);
    throw error;
  }
  if (!candidate) return next;
  const diff = await git(candidate.root, [
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    '--no-ext-diff',
    ...(candidate.head
      ? [candidate.base, candidate.head]
      : [...(candidate.staged ? ['--cached'] : []), candidate.base]),
    '--',
    '.',
    ':(exclude).skaro',
  ]);
  const fields = diff.stdout.split('\0');
  const renames = new Map<string, string>();
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++]!;
    const path = fields[i++]!;
    if (/^[RC]\d+$/.test(status)) {
      const target = fields[i++]!;
      if (status.startsWith('R')) renames.set(path, target);
    }
  }
  const relocate = (paths: string[]) => paths.map((path) => renames.get(path) ?? path);
  for (const element of next.elements) {
    element.code = relocate(element.code);
    element.evidence = relocate(element.evidence);
    if (element.planned?.code) element.planned.code = relocate(element.planned.code);
    if (element.planned?.evidence) element.planned.evidence = relocate(element.planned.evidence);
  }
  return next;
}

export async function assertCandidateC4(model: C4Model, candidate: C4Candidate): Promise<void> {
  const problems = [...inspectC4Model(model), ...(await inspectC4Code(candidate.root, model))];
  // Local unstaged/staged layers cannot supply a file missing from the published code tree.
  if (candidate.head) {
    const tree = await git(candidate.root, ['ls-tree', '-r', '--name-only', '-z', candidate.head]);
    const files = new Set(tree.stdout.split('\0'));
    for (const element of model.elements.filter((item) => item.state === 'current'))
      for (const path of element.code)
        if (!files.has(path))
          problems.push({
            ...c4Issue(`${element.id}: missing published code path ${path}`, 'missing_code_path', [
              element.id,
            ]),
            path,
          });
  }
  if (problems.length) throw new C4PublicationError(problems);
}
