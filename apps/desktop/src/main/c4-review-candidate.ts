import { C4ValidationError, inspectC4Model, type C4Model, type C4Issue } from '@skaro/core';
import { candidateC4Model } from './c4-candidate';
import { inspectC4TaskCode } from './c4-task-code';
import type { C4TaskScope } from './c4-task-scope';

/** Review and submission use the same future model and the same task-checkout path policy. */
export async function inspectC4ReviewCandidate(
  model: C4Model | undefined,
  realized: string[],
  checkout: string,
  baseHead: string,
  scope: C4TaskScope,
): Promise<C4Issue[]> {
  if (!model || scope.kind === 'artifacts') return [];
  try {
    const candidate = await candidateC4Model(model, realized, { root: checkout, base: baseHead });
    return [
      ...(realized.length ? inspectC4Model(candidate) : []),
      ...(await inspectC4TaskCode(
        checkout,
        baseHead,
        {
          ...candidate,
          elements: candidate.elements.filter((item) => scope.elements.includes(item.id)),
        },
        scope.files,
        realized,
      )),
    ];
  } catch (error) {
    if (error instanceof C4ValidationError) return error.diagnostic.issues;
    throw error;
  }
}
