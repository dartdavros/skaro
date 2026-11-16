import { expect, it } from 'vitest';
import { projectTabState } from './project-tab-state';

it('keeps owner attention blue while work continues and returns to work after the last decision', () => {
  const card = { counts: { working: 2, needs: 0, review: 0, failed: 0, blocked: 0 } };
  expect(projectTabState(card, 1)).toBe('attention');
  expect(projectTabState(card, 0)).toBe('working');
  expect(projectTabState({ counts: { ...card.counts, needs: 1 } })).toBe('attention');
  expect(projectTabState({ counts: { ...card.counts, review: 1 } })).toBe('attention');
  expect(projectTabState({ counts: { ...card.counts, working: 0 } })).toBe('none');
});
