import { expect, it } from 'vitest';
import { requireSupportedSchema } from './schema-version.ts';

it('admits supported generations and rejects unknown future or corrupt schema metadata', () => {
  for (const version of [0, 1, 7]) expect(() => requireSupportedSchema(version, 7)).not.toThrow();
  for (const version of [-1, 8, 1.5, NaN, Infinity])
    expect(() => requireSupportedSchema(version, 7)).toThrow('Unsupported database schema');
});
