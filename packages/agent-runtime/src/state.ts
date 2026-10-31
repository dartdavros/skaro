import type { JournalRecord, RuntimeState } from './model.ts';

export const emptyRuntimeState = (): RuntimeState => ({
  toolRequests: {},
  processes: {},
  stopped: false,
  closed: false,
  inputs: [],
  interactions: {},
  answered: {},
  effects: {},
});

/** All live state and checkpoints are disposable projections of the primary journal. */
export function reduceRuntimeRecord(state: RuntimeState, record: JournalRecord): RuntimeState {
  const next = structuredClone(state);
  for (const fact of record.facts) {
    switch (fact.type) {
      case 'created':
        if (next.config) throw new Error('Session already initialized');
        next.config = fact.config;
        next.runtimeVersion = fact.runtimeVersion;
        break;
      case 'input':
        next.inputs.push({ id: fact.id, turnId: fact.turnId });
        next.stopped = false;
        next.closed = false;
        break;
      case 'route':
        if (!next.config) throw new Error('Session not initialized');
        next.config.route = fact.route;
        delete next.continuation;
        break;
      case 'permissions':
        if (!next.config) throw new Error('Session not initialized');
        next.config.permissionMode = fact.mode;
        break;
      case 'stopped':
        next.stopped = true;
        break;
      case 'closed':
        next.stopped = true;
        next.closed = true;
        break;
      case 'interaction':
        if (next.interactions[fact.interaction.id] || next.answered[fact.interaction.id])
          throw new Error('Interaction identity reused');
        next.interactions[fact.interaction.id] = fact.interaction;
        break;
      case 'answer':
        if (!next.interactions[fact.interactionId]) throw new Error('Interaction is not open');
        delete next.interactions[fact.interactionId];
        next.answered[fact.interactionId] = fact.answer;
        break;
      case 'rewind':
        if (!next.inputs.some((input) => input.id === fact.toItemId))
          throw new Error('Unknown rewind input');
        next.rewindBefore = fact.toItemId;
        delete next.continuation;
        break;
      case 'continuation':
        if (JSON.stringify(next.config?.route) !== JSON.stringify(fact.route))
          throw new Error('Native continuation belongs to another route');
        next.continuation = { route: fact.route, value: fact.value };
        break;
      case 'effect-intent':
        if (next.effects[fact.id]) throw new Error('Effect identity reused');
        next.effects[fact.id] = { name: fact.name, state: 'pending' };
        break;
      case 'effect-result':
        if (!next.effects[fact.id] || next.effects[fact.id]!.state !== 'pending')
          throw new Error('Effect has no active intent');
        next.effects[fact.id] = {
          ...next.effects[fact.id]!,
          state: 'completed',
          result: fact.result,
        };
        break;
      case 'recovery':
        for (const id of fact.unknownEffects) {
          if (next.effects[id]?.state !== 'pending') throw new Error('Invalid recovered effect');
          next.effects[id]!.state = 'unknown';
        }
        break;
      case 'effect-unknown':
        if (!next.effects[fact.id] || next.effects[fact.id]!.state !== 'pending')
          throw new Error('Unknown effect has no active intent');
        next.effects[fact.id]!.state = 'unknown';
        break;
      case 'tool-request':
        next.toolRequests[fact.id] = { name: fact.name, hash: fact.hash };
        break;
      case 'process':
        next.processes[fact.id] = {
          owner: fact.owner,
          state: fact.state,
          ...(fact.code !== undefined ? { code: fact.code } : {}),
          ...(fact.error ? { error: fact.error } : {}),
        };
        break;
      case 'timeline':
        break;
    }
  }
  return next;
}

export function restoreRuntime(records: readonly JournalRecord[]): RuntimeState {
  return records.reduce(reduceRuntimeRecord, emptyRuntimeState());
}
