// Agent text: Markdown → sanitized HTML (architecture.md 10). Code gets highlighted, paths in
// `code` become file links when the file exists, remote images wait for a click.

import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { Marked, type Tokens } from 'marked';

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
      // `text` arrives escaped; paths are checked against the working folder later.
      const raw = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return looksLikePath(raw)
        ? `<code class="md-path" data-path="${escape(raw)}">${text}</code>`
        : `<code>${text}</code>`;
    },
    image({ href, text }: Tokens.Image): string {
      if (/^https?:\/\//i.test(href)) {
        // Skaro requests nothing from the web by itself (agent-output.md 5.2).
        return `<span class="md-remote-image" data-src="${escape(href)}" data-alt="${escape(text)}"></span>`;
      }
      return `<span class="md-local-image" data-path="${escape(href)}" data-alt="${escape(text)}"></span>`;
    },
    link({ href, text }: Tokens.Link): string {
      const label = typeof text === 'string' ? text : href;
      if (/^https?:\/\//i.test(href)) {
        return `<a href="${escape(href)}" data-external="1" data-tip="${escape(href)}">${label}</a>`;
      }
      return `<code class="md-path" data-path="${escape(href)}">${label}</code>`;
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
    'span',
    'div',
    'button',
    'input',
  ],
  ALLOWED_ATTR: [
    'href',
    'class',
    'data-path',
    'data-src',
    'data-alt',
    'data-source',
    'data-copy',
    'data-external',
    'data-tip',
    'type',
    'checked',
    'disabled',
    'aria-label',
    'align',
  ],
  ALLOW_DATA_ATTR: false,
};

/** Markdown of an agent message as safe HTML. */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false });
  return DOMPurify.sanitize(html, PURIFY);
}

let mermaid: Promise<typeof import('mermaid').default> | undefined;
let mermaidSeq = 0;

/** Draws Mermaid blocks inside `root` (the library loads on first use). */
export async function drawMermaid(root: HTMLElement): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>('.md-mermaid:not([data-done])')];
  if (!blocks.length) return;
  mermaid ??= import('mermaid').then((m) => {
    m.default.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'strict',
      // SVG text labels: HTML labels would need foreignObject, which sanitizing drops.
      flowchart: { htmlLabels: false },
      fontFamily: 'Nunito Sans Variable, sans-serif',
      themeVariables: {
        background: '#1a1a1a',
        primaryColor: '#242424',
        primaryTextColor: '#c8c8c8',
        primaryBorderColor: '#242424',
        lineColor: '#6f6f6f',
        fontSize: '12px',
      },
    });
    return m.default;
  });
  const lib = await mermaid;
  for (const block of blocks) {
    block.dataset['done'] = '1';
    try {
      const { svg } = await lib.render(`sk-mermaid-${++mermaidSeq}`, block.dataset['source'] ?? '');
      block.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
    } catch {
      block.classList.add('md-mermaid-error');
      block.textContent = block.dataset['source'] ?? '';
    }
  }
}
