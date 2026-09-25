import { describe, expect, it } from 'vitest';
import { taskSections, toggleCriterion, withSummary } from './task-body';

const body = [
  '## Цель',
  '',
  'Исправить сложение.',
  '',
  '## Критерии приёмки',
  '',
  '- add(2, 3) возвращает 5',
  '- [x] тесты зелёные',
  '',
  '## Заметки',
  '',
  'Без спешки.',
  '',
].join('\n');

describe('task body', () => {
  it('reads goal, criteria with their ticks, and notes', () => {
    expect(taskSections(body)).toEqual({
      goal: 'Исправить сложение.',
      criteria: [
        { text: 'add(2, 3) возвращает 5', done: false },
        { text: 'тесты зелёные', done: true },
      ],
      notes: 'Без спешки.',
    });
  });

  it('ticks and unticks a criterion without touching the rest', () => {
    const ticked = toggleCriterion(body, 0);
    expect(ticked).toContain('- [x] add(2, 3) возвращает 5');
    expect(taskSections(ticked).criteria.map((c) => c.done)).toEqual([true, true]);
    expect(taskSections(toggleCriterion(ticked, 1)).criteria.map((c) => c.done)).toEqual([
      true,
      false,
    ]);
    expect(toggleCriterion(body, 5)).toBe(body);
  });

  it('writes the summary once, replacing an older one', () => {
    const once = withSummary(body, 'Сложение исправлено.');
    expect(taskSections(once).summary).toBe('Сложение исправлено.');
    const twice = withSummary(once, 'Исправлено и покрыто тестом.');
    expect(twice.match(/## Итог/g)).toHaveLength(1);
    expect(taskSections(twice)).toMatchObject({
      summary: 'Исправлено и покрыто тестом.',
      notes: 'Без спешки.',
    });
  });
});
