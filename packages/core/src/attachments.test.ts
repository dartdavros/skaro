import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentStore } from './attachments.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skaro-attach-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('AttachmentStore', () => {
  it('stores each content once and returns a reference', () => {
    const store = new AttachmentStore(join(dir, 'attachments'));
    const base64 = Buffer.from('fake png').toString('base64');
    const a = store.save({ base64, mime: 'image/png', width: 10, height: 5 });
    const b = store.save({ base64, mime: 'image/png', path: 'diagram.png' });
    expect(a.id).toBe(b.id);
    expect(a).toEqual({ id: a.id, mime: 'image/png', width: 10, height: 5 });
    expect(b.path).toBe('diagram.png');
    expect(readdirSync(join(dir, 'attachments'))).toEqual([`${a.id}.png`]);
    expect(readFileSync(store.file(a), 'utf8')).toBe('fake png');
  });

  it('refuses ids that are not content hashes', () => {
    const store = new AttachmentStore(dir);
    expect(() => store.file({ id: '../../etc/passwd', mime: 'image/png' })).toThrow(
      'not an attachment id',
    );
  });

  it('gives projections a context', () => {
    const store = new AttachmentStore(dir);
    const ctx = store.context(() => 42);
    expect(ctx.now()).toBe(42);
    expect(ctx.attachImage({ base64: 'aGk=', mime: 'image/gif' }).mime).toBe('image/gif');
  });
});
