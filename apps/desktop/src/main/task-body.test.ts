import { describe, expect, it } from 'vitest';
import {
  setCriteria,
  taskBody,
  taskSections,
  toggleCriterion,
  withSections,
  withSummary,
} from './task-body';

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

  it('sets every criterion from a verdict and leaves the rest of the body', () => {
    const set = setCriteria(body, [true, false]);
    expect(taskSections(set).criteria.map((c) => c.done)).toEqual([true, false]);
    expect(set).toContain('- [x] add(2, 3) возвращает 5');
    expect(set).toContain('- [ ] тесты зелёные');
    expect(taskSections(set).notes).toBe('Без спешки.');
    expect(taskSections(setCriteria(body, [undefined, false])).criteria[0]!.done).toBe(false);
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

  it('builds a new body and patches sections, keeping the rest', () => {
    const fresh = taskBody({ goal: 'Сделать X.', criteria: ['a', 'b'] }, 'ru');
    expect(taskSections(fresh)).toEqual({
      goal: 'Сделать X.',
      criteria: [
        { text: 'a', done: false },
        { text: 'b', done: false },
      ],
    });
    const patched = withSections(withSummary(body, 'Готово.'), { goal: 'Новая цель.' }, 'ru');
    expect(taskSections(patched)).toMatchObject({
      goal: 'Новая цель.',
      notes: 'Без спешки.',
      summary: 'Готово.',
    });
    expect(taskSections(patched).criteria).toHaveLength(2);
    const noted = withSections(fresh, { notes: 'См. ADR-0007.' }, 'en');
    expect(noted).toContain('## Notes\n\nСм. ADR-0007.');
  });
});
