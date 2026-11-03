import { expect, it } from 'vitest';
import { imageSize, exportName } from './image';
import { EXPORT_MAX_PIXELS, EXPORT_MAX_SIDE } from '../../../shared/diagram-export';

it('bounds PNG allocation before rendering, including nonfinite and oversized dimensions', () => {
  expect(imageSize(1000, 600)).toEqual({ width: 2000, height: 1200 });
  for (const value of [NaN, Infinity, 0, -1, EXPORT_MAX_SIDE])
    expect(() => imageSize(value, 100)).toThrow('diagram-export-image-size');
  expect(() => imageSize(Math.sqrt(EXPORT_MAX_PIXELS), Math.sqrt(EXPORT_MAX_PIXELS))).toThrow(
    'diagram-export-image-size',
  );
});
it('creates bounded filenames without path separators', () => {
  const name = exportName('Проект/../test', 'view:context', 'planned', 'r12');
  // eslint-disable-next-line no-control-regex -- Verify filename controls are removed.
  expect(name).not.toMatch(/[<>:"/\\|?*\x00-\x1f]/);
  expect(name).toContain('planned-r12');
  expect(
    exportName('a'.repeat(1000), 'b'.repeat(1000), 'c'.repeat(1000), 'd'.repeat(1000)).length,
  ).toBeLessThanOrEqual(170);
});
