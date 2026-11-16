import { expect, it } from 'vitest';
import { emptyTimeline, type Interaction } from '@skaro/timeline';
import { dispatchFeedback, feedActivity } from './dispatch-feedback';

it('shows accepted preparation before the native turn and stops when no dispatch is pending', () => {
  const idle = emptyTimeline();
  const pending = dispatchFeedback(idle, true)!;
  expect(pending.status).toBe('working');
  expect(pending.activity?.state).toBe('waiting_model');
  expect(idle.status).toBe('idle');
  expect(dispatchFeedback(idle, false)).toBe(idle);
  expect(dispatchFeedback(undefined, true)?.activity?.state).toBe('waiting_model');
});

it('keeps the answer card while showing its submission, and waits for other unanswered cards', () => {
  const question: Interaction = { id: 'question', kind: 'question', questions: [] };
  const state = { ...emptyTimeline(), status: 'waiting' as const, interactions: [question] };
  expect(dispatchFeedback(state, true)).toBe(state);
  const answering = dispatchFeedback(state, false, ['question'])!;
  expect(answering.activity?.state).toBe('waiting_model');
  expect(answering.interactions).toEqual([question]);
  const another = { ...state, interactions: [question, { ...question, id: 'other' }] };
  expect(dispatchFeedback(another, true, ['question'])).toBe(another);
});

it('hands over to real model activity and gives working without activity the existing waiting line', () => {
  const working = { ...emptyTimeline(), status: 'working' as const };
  expect(feedActivity(working)?.state).toBe('waiting_model');
  expect(feedActivity(emptyTimeline())).toBeUndefined();
  const thinking = { ...working, activity: { state: 'thinking' } };
  expect(dispatchFeedback(thinking, true)).toBe(thinking);
  expect(feedActivity(thinking)).toEqual({ state: 'thinking' });
});
