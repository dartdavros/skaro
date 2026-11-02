import { expect, it } from 'vitest';
import { sumReportedAmounts } from '../../../../packages/agent-runtime/src/models/reported-amount';

it('adds reported decimal amounts exactly across exponent scales without binary rounding or a made-up zero receipt', () => {
  expect(sumReportedAmounts(['0.1', '0.2'])).toBe('0.3');
  expect(sumReportedAmounts(['1e-10', '0.0000000009'])).toBe('0.000000001');
  expect(sumReportedAmounts(['12.500', '7.5e1'])).toBe('87.5');
  expect(sumReportedAmounts(['0.000'])).toBe('0');
  expect(sumReportedAmounts(['100', '0'])).toBe('100');
  for (const value of ['-1', 'NaN', 'Infinity', '1e999', 'USD 1'])
    expect(() => sumReportedAmounts([value])).toThrow();
});
