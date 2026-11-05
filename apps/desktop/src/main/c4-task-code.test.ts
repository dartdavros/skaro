import { expect, it } from 'vitest';
import { deferBaseOnlyPath } from './c4-task-code';

it('defers only paths introduced exclusively by the newer base', () => {
  const path = 'src/new.ts';
  const present = new Set([path]);
  const absent = new Set<string>();
  expect(deferBaseOnlyPath(path, present, absent, absent, absent)).toBe(true);
  // A task deletion, an existing task file, or an uncommitted change must still be checked.
  expect(deferBaseOnlyPath(path, present, present, absent, absent)).toBe(false);
  expect(deferBaseOnlyPath(path, present, absent, present, absent)).toBe(false);
  expect(deferBaseOnlyPath(path, present, absent, absent, present)).toBe(false);
  // A path that does not exist on the base is never excused by branch divergence.
  expect(deferBaseOnlyPath(path, absent, absent, absent, absent)).toBe(false);
});
