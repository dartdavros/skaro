// A document as blocks (Documents mockup): headings with anchors for "На странице", the
// "Правила и ограничения" card, code with a copy button, Mermaid, the rest as safe HTML.

import { Marked, type Token, type Tokens } from 'marked';
import { isC4Diagram } from '../c4/markdown-policy';

export type Block =
  | { kind: 'html'; html: string; hid?: string }
  | { kind: 'rules'; hid: string; title: string; items: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'mermaid'; source: string };

export interface Heading {
  hid: string;
  text: string;
  position: number;
}

const RULES = /правила|rules/i;
const marked = new Marked({ gfm: true, breaks: false });

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

marked.use({
  renderer: {
    code(token: Tokens.Code): string | false {
      const language = (token.lang ?? '').trim().split(/\s+/)[0] ?? '';
      return isC4Diagram(language, token.text) ? '' : false;
    },
    link(token: Tokens.Link): string {
      const label = this.parser.parseInline(token.tokens);
      return `<a href="#" data-href="${escape(token.href)}">${label}</a>`;
    },
  },
});

function html(tokens: Token[]): string {
  return marked.parser(tokens);
}

export function inline(text: string): string {
  return marked.parseInline(text, { async: false });
}

export function parseDoc(src: string): { blocks: Block[]; headings: Heading[] } {
  const blocks: Block[] = [];
  const headings: Heading[] = [];
  const tokens = marked.lexer(src);
  let n = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.type === 'space') continue;
    if (token.type === 'heading' && token.depth <= 2) {
      const hid = `h${++n}`;
      const text = token.text;
      headings.push({ hid, text, position: blocks.length });
      let nextIndex = i + 1;
      while (tokens[nextIndex]?.type === 'space') nextIndex++;
      const next = tokens[nextIndex];
      if (RULES.test(text) && next?.type === 'list') {
        i = nextIndex;
        blocks.push({
          kind: 'rules',
          hid,
          title: text,
          items: (next as Tokens.List).items.map((item) => inline(item.text)),
        });
        continue;
      }
      blocks.push({ kind: 'html', html: `<h2>${inline(text)}</h2>`, hid });
      continue;
    }
    if (token.type === 'code') {
      const lang = (token.lang ?? '').trim().split(/\s+/)[0] ?? '';
      if (isC4Diagram(lang, token.text)) continue;
      blocks.push(
        lang === 'mermaid'
          ? { kind: 'mermaid', source: token.text }
          : { kind: 'code', lang: lang || 'text', text: token.text },
      );
      continue;
    }
    blocks.push({ kind: 'html', html: html([token]) });
  }
  return { blocks, headings };
}
