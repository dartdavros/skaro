import { expect, it } from 'vitest';
import { ownerInputDisposition } from './owner-input-policy.ts';
import { commandFacts, resumesAfterInput } from '../commands.ts';
import { emptyRuntimeState } from '../state.ts';
import { ownerInputRecord } from './owner-input-record.ts';

it('admits active-only steering solely before the current owner turn seals its final boundary', () => {
  const input = { text: 'Accepted package context changed', onlyActiveTurn: true };
  expect(ownerInputDisposition(input, 'steer', true, false)).toBe('steer');
  expect(ownerInputDisposition(input, 'steer', true, true)).toBe('skip');
  expect(ownerInputDisposition(input, 'steer', false, true)).toBe('skip');
  expect(ownerInputDisposition(input, 'steer', false, false)).toBe('skip');
  expect(ownerInputDisposition(input, 'send', false, false)).toBe('skip');
});

it('preserves ordinary owner send and steer admission including a completed-turn fallback', () => {
  const input = { text: 'Ordinary authorized input' };
  expect(ownerInputDisposition(input, 'steer', false, true)).toBe('start');
  expect(ownerInputDisposition(input, 'steer', true, false)).toBe('steer');
  expect(ownerInputDisposition(input, 'steer', true, true)).toBe('wait');
  expect(ownerInputDisposition(input, 'send', true, false)).toBe('busy');
});

it('cannot turn an unconnected active-only update into input, turn or resume facts', () => {
  const state = { ...emptyRuntimeState(), stopped: true, closed: true };
  const before = structuredClone(state);
  const action = { type: 'steer' as const, input: { text: 'Context only', onlyActiveTurn: true } };
  expect(commandFacts(state, action)).toEqual({ facts: [] });
  expect(state).toEqual(before);
  expect(resumesAfterInput(action, state)).toBe(false);
  expect(resumesAfterInput(action, { ...state, stopped: false, closed: false })).toBe(false);
});

it('retains the delivery restriction in the canonical owner input rather than dropping it at journaling', () => {
  const input = { text: 'Context only', onlyActiveTurn: true };
  const record = ownerInputRecord(
    { id: 'context-update', action: { type: 'steer', input } },
    'current',
  );
  expect(record.input.input).toEqual(input);
  expect(record.input.mode).toBe('steer');
  expect(record.facts[0]).toMatchObject({ type: 'input', turnId: 'current', input });
  expect(
    record.facts.some((fact) => fact.type === 'timeline' && fact.event.t === 'turn.started'),
  ).toBe(false);
});
