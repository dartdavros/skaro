import { describe, expect, it } from 'vitest';
import { withBlock } from './agent-files';

describe('withBlock', () => {
  it('adds the block after the user text and keeps that text', () => {
    const next = withBlock('# Rules\n\nBe nice.\n', '## Skaro');
    expect(next).toBe(
      '# Rules\n\nBe nice.\n\n<!-- skaro:begin -->\n## Skaro\n<!-- skaro:end -->\n',
    );
  });

  it('replaces an existing block instead of adding a second one', () => {
    const once = withBlock('Intro\n', 'old');
    expect(withBlock(once, 'new')).toBe('Intro\n\n<!-- skaro:begin -->\nnew\n<!-- skaro:end -->\n');
  });

  it('takes the block out and leaves the rest as it was', () => {
    const once = withBlock('Intro\n', 'block');
    expect(withBlock(once, undefined)).toBe('Intro\n');
  });

  it('leaves nothing when the file held only the block', () => {
    expect(withBlock(withBlock('', 'block'), undefined)).toBe('');
  });
});
