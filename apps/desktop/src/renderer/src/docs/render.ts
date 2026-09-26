// A document as blocks (Documents mockup): headings with anchors for "На странице", the
// "Правила и ограничения" card, code with a copy button, Mermaid, the rest as safe HTML.

import DOMPurify from 'dompurify';
import { Marked, type Token, type Tokens } from 'marked';

export type Block =
  | { kind: 'html'; html: string; hid?: string }
  | { kind: 'rules'; hid: string; title: string; items: string[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'mermaid'; source: string };

export interface Heading {
  hid: string;
  text: string;
}

const RULES = /правила|rules/i;
const marked = new Marked({ gfm: true, breaks: false });

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

marked.use({
  renderer: {
    link(token: Tokens.Link): string {
      const label = this.parser.parseInline(token.tokens);
      return `<a href="#" data-href="${escape(token.href)}">${label}</a>`;
    },
  },
});

const PURIFY = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'hr',
    'strong',
    'em',
    'del',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a',
    'input',
  ],
  ALLOWED_ATTR: ['href', 'data-href', 'type', 'checked', 'disabled', 'align'],
  ALLOW_DATA_ATTR: false,
};

function html(tokens: Token[]): string {
  return DOMPurify.sanitize(marked.parser(tokens), PURIFY);
}

export function inline(text: string): string {
  return DOMPurify.sanitize(marked.parseInline(text, { async: false }), PURIFY);
}

export function renderDoc(src: string): { blocks: Block[]; headings: Heading[] } {
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
      headings.push({ hid, text });
      const next = tokens.slice(i + 1).find((x) => x.type !== 'space');
      if (RULES.test(text) && next?.type === 'list') {
        i = tokens.indexOf(next);
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
