import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { parseAgentMarkdown, parseAgentMarkdownParts } from '../renderer/src/feed/markdown-parse';

it('keeps the existing Markdown rendering of actual repository documents when partitioned', async () => {
  for (const path of ['agent-output.md', 'architecture.md', 'ui-baseline.md']) {
    const file = fileURLToPath(new URL(`../../../../docs/${path}`, import.meta.url));
    const text = await readFile(file, 'utf8');
    const parts = parseAgentMarkdownParts(text);
    expect(parts.join('')).toBe(parseAgentMarkdown(text));
    expect(parts.length).toBeGreaterThan(1);
  }
});

it('defers an unfinished Mermaid fence and preserves the finished block as later text arrives', async () => {
  const readme = await readFile(
    new URL('../../node_modules/mermaid/README.md', import.meta.url),
    'utf8',
  );
  const example = /^```mermaid\r?\n[\s\S]*?\r?\n```/m.exec(readme)![0];
  const open = example.slice(0, -3);
  expect(parseAgentMarkdownParts(open).join('')).toContain('md-mermaid-open');
  const [complete] = parseAgentMarkdownParts(example);
  expect(complete).toContain('class="md-mermaid"');
  expect(parseAgentMarkdownParts(example + '\n\n' + readme.slice(0, 30))[0]).toBe(complete);
  const longFence = example.replace(/^```/gm, '~~~~');
  expect(parseAgentMarkdownParts(longFence.slice(0, -1)).join('')).toContain('md-mermaid-open');
  expect(parseAgentMarkdownParts(longFence).join('')).toContain('class="md-mermaid"');
});
