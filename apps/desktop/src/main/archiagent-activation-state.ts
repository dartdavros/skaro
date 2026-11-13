import type { AppDb } from '@skaro/core';
import type { ArchiagentActivation } from '../shared/archiagent-activation';

export const activationKey = (project: string) => `archiagent.activation.${project}`;
export const activationFeatures = { coordination: 1, resources: 1, c4: 1 } as const;
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;

export function parseActivation(value: unknown): ArchiagentActivation | undefined {
  if (value === undefined) return undefined;
  const state = value as ArchiagentActivation;
  if (
    state?.version !== 1 ||
    !integer(state.revision) ||
    !integer(state.dispatchRevision) ||
    !integer(state.schemaVersion) ||
    typeof state.coordinatorId !== 'string' ||
    !state.coordinatorId ||
    typeof state.requestId !== 'string' ||
    !state.requestId ||
    !['package-v1', 'impact-v1'].includes(state.protocol) ||
    !hash(state.requestHash) ||
    !hash(state.eligibility) ||
    !state.features ||
    Object.keys(state.features).sort().join(',') !== 'c4,coordination,resources' ||
    Object.values(state.features).some((version) => version !== 1)
  )
    throw new Error(
      'Unsupported or invalid archiagent activation; preserve state and keep dispatch off',
    );
  return state;
}

/** A future record or a separately changed C4 default cannot enter the legacy dispatch path. */
export function activationBlocksDispatch(db: AppDb, project: string) {
  try {
    const state = parseActivation(
      db.getSetting(activationKey(project), undefined, { strict: true }),
    );
    return (
      !!state &&
      (state.coordinatorId !== db.coordination.get(project)?.id ||
        state.schemaVersion > db.schemaVersion ||
        state.protocol !==
          db.getSetting(`c4.coordination.protocol.${project}`, 'package-v1', { strict: true }))
    );
  } catch {
    return true;
  }
}
