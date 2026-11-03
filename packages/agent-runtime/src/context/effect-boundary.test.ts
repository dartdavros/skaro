import { expect, it } from 'vitest';
import { contextProjectionBlocked, unresolvedOperationalEffects } from './effect-boundary.ts';
import type { RuntimeState } from '../model.ts';
import { emptyRuntimeState } from '../state.ts';

it('permits fresh owner context after unknown model billing while preserving the effect metadata', () => {
  for (const name of ['model:chat', 'model:openai.responses', 'model:anthropic.messages']) {
    const state = { interactions: {}, effects: { request: { name, state: 'unknown' as const } } };
    const before = structuredClone(state);
    expect(contextProjectionBlocked(state)).toBe(true);
    expect(contextProjectionBlocked(state, true)).toBe(false);
    expect(state).toEqual(before);
  }
});

it('keeps unknown command outcomes blocking and refuses unproven model-billing metadata', () => {
  // Pure effect DTOs only; no primary records, commands, project or backend are created.
  const state = emptyRuntimeState();
  for (const effect of [
    { name: 'run_command', state: 'unknown' as const },
    { name: 'model:chat', state: 'pending' as const },
    { name: 'model:unrecognized', state: 'unknown' as const },
  ]) {
    state.effects = { effect };
    expect(unresolvedOperationalEffects({ state, records: [] })).toEqual([['effect', effect]]);
  }
  state.effects = { effect: { name: 'model:chat', state: 'unknown' } };
  expect(() => unresolvedOperationalEffects({ state, records: [] })).toThrow('primary provenance');
});

it('keeps pending requests, unknown tools and open interactions blocking', () => {
  const effects: RuntimeState['effects'][] = [
    { request: { name: 'model:chat', state: 'pending' } },
    { request: { name: 'model:unrecognized', state: 'unknown' } },
    { tool: { name: 'run_command', state: 'unknown' } },
    {
      request: { name: 'model:chat', state: 'unknown' },
      tool: { name: 'write_file', state: 'unknown' },
    },
  ];
  for (const value of effects)
    expect(contextProjectionBlocked({ interactions: {}, effects: value }, true)).toBe(true);
  expect(
    contextProjectionBlocked(
      { interactions: { open: {} as RuntimeState['interactions'][string] }, effects: {} },
      true,
    ),
  ).toBe(true);
  expect(
    contextProjectionBlocked(
      { interactions: {}, effects: { request: { name: 'model:chat', state: 'completed' } } },
      true,
    ),
  ).toBe(false);
});
