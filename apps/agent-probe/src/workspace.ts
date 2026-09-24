import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

/** Creates a throwaway git repo with a tiny project the scenarios work on. */
export function createWorkspace(name: string): string {
  const root = join(tmpdir(), 'skaro-probe');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, `${name}-`));

  const files: Record<string, string | Buffer> = {
    'README.md': '# calc\n\nTiny calculator library used by the Skaro agent probe.\n',
    'package.json':
      JSON.stringify({ name: 'calc', type: 'module', scripts: { test: 'node test.js' } }, null, 2) +
      '\n',
    'src/math.js': [
      'export function add(a, b) {',
      '  return a - b;',
      '}',
      '',
      'export function mul(a, b) {',
      '  return a * b;',
      '}',
      '',
    ].join('\n'),
    'test.js': [
      "import assert from 'node:assert/strict';",
      "import { add, mul } from './src/math.js';",
      '',
      'assert.equal(mul(2, 3), 6);',
      'assert.equal(add(2, 3), 5);',
      "console.log('all tests passed');",
      '',
    ].join('\n'),
    'diagram.png': circlePng(96, 64),
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }

  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Skaro Probe', '-c', 'user.email=probe@skaro.dev', ...args],
      {
        cwd: dir,
        stdio: 'ignore',
      },
    );
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  return dir;
}

/** A red circle on white, encoded as PNG without dependencies. */
function circlePng(width: number, height: number): Buffer {
  const rows: Buffer[] = [];
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 6;
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3, 255);
    row[0] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) {
        row[1 + x * 3] = 220;
        row[2 + x * 3] = 40;
        row[3 + x * 3] = 40;
      }
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
