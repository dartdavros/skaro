import hljs from 'highlight.js/lib/common';
import { Marked, type Tokens } from 'marked';
import { isC4Diagram } from '../c4/markdown-policy';

const marked = new Marked({ gfm: true, breaks: false });

/** Looks like a project path: has a slash or a known extension, optional :line. */
const PATH =
  /^(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.\w{1,8}(?::\d+(?::\d+)?)?$|^(?:[\w@.-]+\/)+[\w@.-]*$/;

export function looksLikePath(text: string): boolean {
  return text.length < 200 && !/\s/.test(text) && PATH.test(text) && !/^\d/.test(text);
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

marked.use({
  renderer: {
    code({ text, lang }: Tokens.Code): string {
      const language = (lang ?? '').trim().split(/\s+/)[0] ?? '';
      if (isC4Diagram(language, text)) return '';
      if (language === 'mermaid') {
        return `<div class="md-mermaid" data-source="${escape(text)}"></div>`;
      }
      const known = language && hljs.getLanguage(language);
      const html = known
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : escape(text);
      return (
        `<div class="md-code"><div class="md-code-head"><span>${escape(language)}</span>` +
        `<button type="button" class="md-copy" data-copy="1" aria-label="copy"></button></div>` +
        `<pre><code class="hljs">${html}</code></pre></div>`
      );
    },
    codespan({ text }: Tokens.Codespan): string {
      // `text` arrives raw: `<object>` in backticks is text, never a tag. Paths are checked
      // against the working folder later.
      return looksLikePath(text)
        ? `<code class="md-path" data-path="${escape(text)}">${escape(text)}</code>`
        : `<code>${escape(text)}</code>`;
    },
    image({ href, text }: Tokens.Image): string {
      if (/^https?:\/\//i.test(href)) {
        // Skaro requests nothing from the web by itself (agent-output.md 5.2).
        return `<span class="md-remote-image" data-src="${escape(href)}" data-alt="${escape(text)}"></span>`;
      }
      return `<span class="md-local-image" data-path="${escape(href)}" data-alt="${escape(text)}"></span>`;
    },
    link(token: Tokens.Link): string {
      const { href } = token;
      // The label is Markdown of its own (inline code, emphasis), rendered and escaped by marked.
      const label = this.parser.parseInline(token.tokens);
      if (/^https?:\/\//i.test(href)) {
        return `<a href="${escape(href)}" data-external="1" data-tip="${escape(href)}">${label}</a>`;
      }
      return `<code class="md-path" data-path="${escape(href)}">${label}</code>`;
    },
  },
});

/** Pure parsing/highlighting runs in the document worker, never during a Svelte render. */
export function parseAgentMarkdown(text: string): string {
  return marked.parse(text, { async: false });
}

/** Complete Markdown blocks keep their semantics; definitions are resolved by the full lexer. */
export function parseAgentMarkdownParts(text: string): string[] {
  const tokens = marked.lexer(text);
  // Raw HTML can open a container across Markdown blocks. Preserve its single parse context.
  if (tokens.some((token) => token.type === 'html')) return [parseAgentMarkdown(text)];
  const parts: string[] = [];
  let pending: typeof tokens = Object.assign([], { links: tokens.links });
  let size = 0;
  const flush = () => {
    if (!pending.length) return;
    parts.push(marked.parser(pending, marked.defaults));
    pending = Object.assign([], { links: tokens.links });
    size = 0;
  };
  for (const token of tokens) {
    if (size && size + token.raw.length > 8192) flush();
    pending.push(token);
    size += token.raw.length;
  }
  flush();
  return parts;
}
