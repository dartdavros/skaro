// Agent text: Markdown → sanitized HTML (architecture.md 10). Code gets highlighted, paths in
// `code` become file links when the file exists, remote images wait for a click.

import { htmlSanitizer, fragmentSanitizer } from '../sanitize';
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

const sanitizeHtml = htmlSanitizer(PURIFY);
export const markdownFragment = fragmentSanitizer(PURIFY);
/** Markdown of an agent message as safe HTML. */
export function sanitizeMarkdown(html: string): string {
  return sanitizeHtml(html);
}
