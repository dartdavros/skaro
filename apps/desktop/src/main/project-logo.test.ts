import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES } from '../shared/ipc';
import { readLogo } from './project-logo';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skaro-logo-'));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

describe('readLogo', () => {
  it('turns SVG, PNG and JPG into data: URLs', async () => {
    const svg = join(dir, 'logo.svg');
    await writeFile(svg, '<svg/>');
    expect(await readLogo(svg)).toBe(
      `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
    );
    const jpg = join(dir, 'LOGO.JPEG');
    await writeFile(jpg, 'x');
    expect(await readLogo(jpg)).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('refuses other types and files over the limit', async () => {
    const gif = join(dir, 'logo.gif');
    await writeFile(gif, 'x');
    await expect(readLogo(gif)).rejects.toThrow('unsupported');
    const big = join(dir, 'big.png');
    await writeFile(big, Buffer.alloc(LOGO_MAX_BYTES + 1));
    await expect(readLogo(big)).rejects.toThrow('too large');
  });
});
