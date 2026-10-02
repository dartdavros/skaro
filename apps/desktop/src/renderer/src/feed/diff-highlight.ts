// Syntax colours of the diff window: shiki, loaded on first use, with the grammar of the file's
// language loaded on demand. Colours are CSS variables (diff-modal.css maps them to the palette).

import type { HighlighterCore, ThemedToken } from 'shiki/core';
import type { NumberedLine } from './diff-model';

/** A run of text and its colour (a CSS value). */
export interface Segment {
  text: string;
  color?: string;
}

const THEME = 'skaro-diff';
/** Beyond this many lines a diff stays plain: colouring would stall the window. */
const MAX_LINES = 4000;

let core: Promise<HighlighterCore> | undefined;
let langs: Promise<typeof import('shiki/langs')> | undefined;

function highlighter(): Promise<HighlighterCore> {
  core ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
      await Promise.all([import('shiki/core'), import('shiki/engine/javascript')]);
    return createHighlighterCore({
      themes: [
        createCssVariablesTheme({ name: THEME, variablePrefix: '--sk-syn-', fontStyle: false }),
      ],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  return core;
}

/** The shiki language of a path by its extension or name, if there is a grammar for it. */
async function languageOf(path: string): Promise<string | undefined> {
  langs ??= import('shiki/langs');
  const { bundledLanguages, bundledLanguagesAlias } = await langs;
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const ext = name.includes('.') ? name.split('.').pop()! : name;
  for (const id of [ext, name]) {
    if (id in bundledLanguages) return id;
    if (id in bundledLanguagesAlias) return id;
  }
  return undefined;
}

function segments(tokens: ThemedToken[] | undefined): Segment[] | undefined {
  return tokens?.map((t) => ({ text: t.content, ...(t.color ? { color: t.color } : {}) }));
}

/**
 * Colours for the code lines of a diff, by line index; undefined when the language is unknown or
 * the diff is too big. The old side (context and removed lines) and the new side (context and
 * added lines) are coloured as two texts, so each keeps its grammar state across lines.
 */
export async function highlightDiff(
  path: string,
  lines: NumberedLine[],
): Promise<(Segment[] | undefined)[] | undefined> {
  if (lines.length > MAX_LINES) return undefined;
  const lang = await languageOf(path);
  if (!lang) return undefined;
  const hl = await highlighter();
  if (!hl.getLoadedLanguages().includes(lang)) {
    const { bundledLanguages } = await (langs ??= import('shiki/langs'));
    const loader = bundledLanguages[lang as keyof typeof bundledLanguages];
    if (!loader) return undefined;
    await hl.loadLanguage(await loader());
  }
  const sides = { old: [] as number[], new: [] as number[] };
  lines.forEach((line, index) => {
    if (line.kind === 'ctx' || line.kind === 'del') sides.old.push(index);
    if (line.kind === 'ctx' || line.kind === 'add') sides.new.push(index);
  });
  const out: (Segment[] | undefined)[] = lines.map(() => undefined);
  for (const side of [sides.old, sides.new]) {
    if (!side.length) continue;
    const code = side.map((index) => lines[index]!.text).join('\n');
    const tokens = hl.codeToTokensBase(code, { lang, theme: THEME });
    side.forEach((index, at) => {
      out[index] ??= segments(tokens[at]);
    });
  }
  return out;
}
