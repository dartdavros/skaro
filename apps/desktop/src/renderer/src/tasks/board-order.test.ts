import { expect, it } from 'vitest';
import type { TaskSummary } from '../../../shared/ipc';
import { arrange, placed } from './board-order';

const t = (id: string) => ({ id }) as TaskSummary;

it('keeps the dragged order and puts new cards after it', () => {
  const tasks = ['T-1', 'T-2', 'T-3', 'T-4'].map(t);
  expect(arrange(tasks, ['T-3', 'T-1']).map((x) => x.id)).toEqual(['T-3', 'T-1', 'T-2', 'T-4']);
  expect(placed(['T-1', 'T-2', 'T-3'], 'T-3', 0)).toEqual(['T-3', 'T-1', 'T-2']);
  expect(placed(['T-1', 'T-2'], 'T-9', 1)).toEqual(['T-1', 'T-9', 'T-2']);
});
