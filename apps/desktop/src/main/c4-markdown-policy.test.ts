import { expect, it } from 'vitest';
import { parseDoc } from '../renderer/src/docs/parse';
import { parseAgentMarkdown, parseAgentMarkdownParts } from '../renderer/src/feed/markdown-parse';

it('omits C4 diagrams from document and conversation Markdown, including nested blocks', () => {
  for (const [language, source] of [
    ['skaro-c4', '{}'],
    ...['Context', 'Container', 'Component', 'Dynamic', 'Deployment'].map((kind) => [
      'mermaid',
      `---\ntitle: Architecture\n---\n%% diagram\nC4${kind}\n`,
    ]),
  ]) {
    const fence = `\`\`\`${language}\n${source}\n\`\`\``;
    for (const code of [
      fence,
      fence
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n'),
    ]) {
      const markdown = `Before\n\n${code}\n\nAfter`;
      const document = JSON.stringify(parseDoc(markdown).blocks);
      const message = parseAgentMarkdown(markdown);
      for (const output of [document, message, parseAgentMarkdownParts(markdown).join('')]) {
        expect(output).toContain('Before');
        expect(output).toContain('After');
        expect(output).not.toMatch(
          /skaro-c4|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|md-mermaid/,
        );
        expect(output).not.toContain('{}');
      }
    }
  }
});

it('preserves ordinary Mermaid diagrams and code blocks', () => {
  const markdown = '```mermaid\nflowchart LR\nA --> B\n```\n\n```ts\nconst answer = 42;\n```';
  expect(parseDoc(markdown).blocks).toEqual([
    { kind: 'mermaid', source: 'flowchart LR\nA --> B' },
    { kind: 'code', lang: 'ts', text: 'const answer = 42;' },
  ]);
  expect(parseAgentMarkdown(markdown)).toContain('md-mermaid');
  expect(parseAgentMarkdown(markdown)).toContain('answer');
});
