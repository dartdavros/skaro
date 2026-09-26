import { describe, expect, it } from 'vitest';
import { milestoneBody, milestoneSections } from './plan';

describe('milestone sections', () => {
  it('reads the goal and the done criterion in both languages', () => {
    expect(
      milestoneSections(
        '## Цель\n\nПринимать оплату.\n\n## Критерий готовности\n\nВсё работает.\n',
      ),
    ).toEqual({
      goal: 'Принимать оплату.',
      criteria: 'Всё работает.',
    });
    expect(milestoneSections('## Goal\nShip it\n## Done when\nIt ships')).toEqual({
      goal: 'Ship it',
      criteria: 'It ships',
    });
  });

  it('writes what it reads back', () => {
    const body = milestoneBody({ title: 'M', goal: 'A goal', criteria: 'A criterion' }, 'ru');
    expect(milestoneSections(body)).toEqual({ goal: 'A goal', criteria: 'A criterion' });
  });

  it('skips empty sections', () => {
    expect(milestoneSections('## Цель\n\n## Критерий готовности\n')).toEqual({});
  });
});
