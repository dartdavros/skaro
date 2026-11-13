import { delimiter, dirname } from 'node:path';
import { expect, it } from 'vitest';
import { appServerEnvironment } from './process-environment.ts';

it('preserves the actual host path and gives an explicit task path precedence without duplicate Windows spellings', () => {
  const actual = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')?.[1];
  expect(actual).toBeTruthy();
  const key = process.platform === 'win32' ? 'Path' : 'PATH';
  const inherited = { [key]: actual };
  const helpers = dirname(process.execPath);
  const result = appServerEnvironment(inherited, {}, [helpers]);
  expect(result.PATH).toBe(`${helpers}${delimiter}${actual}`);
  expect(Object.keys(result).filter((name) => name.toLowerCase() === 'path')).toEqual(['PATH']);
  expect(appServerEnvironment(inherited, { PATH: helpers }, []).PATH).toBe(helpers);
  expect(inherited[key]).toBe(actual);
});
