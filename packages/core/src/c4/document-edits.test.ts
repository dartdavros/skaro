import { describe, expect, it } from 'vitest';
import { resolveC4DocumentChange } from './document-edits.ts';
import { c4Hash } from './documents.ts';

const path = 'architecture.md';

describe('agent C4 document edits', () => {
  it('preserves all source bytes outside the exact edits', () => {
    const prefix = '# Architecture\r\n\r\n' + 'Unchanged section.\r\n'.repeat(2_000);
    const source = prefix + '## Target\r\nOld paragraph.\r\n\r\n## Footer\r\nKeep.  \r\n';
    const actual = resolveC4DocumentChange(
      {
        path,
        baseHash: c4Hash(source),
        edits: [{ oldText: '## Target\nOld paragraph.', newText: '## Target\nNew paragraph.' }],
      },
      source,
      true,
    );
    expect(actual).toBe(source.replace('Old paragraph.', 'New paragraph.'));
  });

  it('rejects whole-file replacement and edits against stale or ambiguous text', () => {
    const source = '# Architecture\nRepeat\nRepeat\n';
    const edit = {
      path,
      baseHash: c4Hash(source),
      edits: [{ oldText: 'Repeat', newText: 'Changed' }],
    };
    expect(() => resolveC4DocumentChange({ path, content: '# Truncated' }, source, true)).toThrow(
      'existing documents require',
    );
    expect(() => resolveC4DocumentChange(edit, source + '\n', true)).toThrow(
      'does not match base_hash',
    );
    expect(() => resolveC4DocumentChange(edit, source, true)).toThrow('exactly one');
    expect(() =>
      resolveC4DocumentChange(
        {
          ...edit,
          edits: [
            { oldText: '# Architecture', newText: '# New' },
            { oldText: 'Architecture\nRepeat\nRepeat', newText: 'New' },
          ],
        },
        source,
        true,
      ),
    ).toThrow('overlap');
    expect(resolveC4DocumentChange({ path, content: '# A new file' }, undefined, true)).toBe(
      '# A new file\n',
    );
  });
});
