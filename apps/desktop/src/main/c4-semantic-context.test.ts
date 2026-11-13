import { expect, it } from 'vitest';
import { skaroC4 } from '../../../../docs/c4/skaro-model';
import {
  c4SemanticContext,
  c4SemanticContextHash,
  c4SemanticTaskBody,
} from './c4-semantic-context';
import { taskBody, setCriteria, withSummary } from './task-body';
import { localC4Scope } from './c4-preservation';

it('keeps the same semantic task body after real host criterion and summary writers', () => {
  const description = skaroC4.elements.find((e) => e.id === 'c4service')!.description;
  const body = taskBody({ goal: description, criteria: [description] }, 'ru');
  const accepted = withSummary(setCriteria(body, [true]), 'Host completion metadata');
  expect(c4SemanticTaskBody(accepted)).toBe(c4SemanticTaskBody(body));
  expect(c4SemanticTaskBody(accepted.replace(description, 'Changed responsibility'))).not.toBe(
    c4SemanticTaskBody(body),
  );
});

it('preserves authored whitespace and code blocks when the host adds or replaces a summary', () => {
  const authored =
    '\n## Цель\n\nСохранить формат требований.\n\n\n```text\nfirst\n\n\nlast\n```\n\n## Критерии приёмки\n\n- [ ] Не менять код и требования.\n\n\nДополнительное условие.\n';
  const added = withSummary(setCriteria(authored, [true]), 'Первый отчёт');
  const replaced = withSummary(added, 'Повторный отчёт');
  expect(c4SemanticTaskBody(added)).toBe(c4SemanticTaskBody(authored));
  expect(c4SemanticTaskBody(replaced)).toBe(c4SemanticTaskBody(authored));
  expect(replaced).toContain('first\n\n\nlast');
  expect(replaced).toContain('\n\n\nДополнительное условие.');
});

it('uses documented code leaves while retaining parent semantics, and ignores unrelated model objects', () => {
  const model = structuredClone(skaroC4);
  const scope = localC4Scope(
    {
      kind: 'implementation',
      files: ['apps/desktop/src/main/c4-service.ts'],
      requirements: [],
      elements: ['c4service', 'serviceclass'],
      relationships: [],
    },
    model,
  );
  expect(scope.elements).toEqual(['serviceclass']);
  const input = { c4: model, tasks: [], specs: [], adrs: [] };
  const semantic = c4SemanticContext(input, 'C4-2', scope);
  expect(semantic.elements.map((e) => e.id)).toContain('main');
  const fingerprint = c4SemanticContextHash(semantic);
  model.revision++;
  model.elements.find((e) => e.id === 'canvas')!.description += ' unrelated canvas detail';
  expect(c4SemanticContextHash(c4SemanticContext(input, 'C4-2', scope))).toBe(fingerprint);
  model.elements.find((e) => e.id === 'c4service')!.description += ' changed parent responsibility';
  expect(c4SemanticContextHash(c4SemanticContext(input, 'C4-2', scope))).not.toBe(fingerprint);
});
