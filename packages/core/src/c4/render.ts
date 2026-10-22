import type { C4Model } from './model.ts';

export const C4_SECTION_START = '<!-- skaro:c4:start -->';
export const C4_SECTION_END = '<!-- skaro:c4:end -->';

export function authoredBody(body: string): string {
  return body.replace(/\n?<!-- skaro:c4:start -->[\s\S]*?<!-- skaro:c4:end -->\n?/g, '').trimEnd();
}

/** Legacy self-contained export only. Persisted sources and package reviews never embed a model. */
export function c4Section(model: C4Model, views: string[], locale: string): string {
  const ru = locale === 'ru';
  return [
    C4_SECTION_START,
    `## C4 · ${model.revision}`,
    '',
    ru
      ? 'Текущая архитектура и планируемые изменения отмечены в каждом представлении.'
      : 'Current architecture and planned changes are identified in each view.',
    '',
    '```skaro-c4',
    JSON.stringify({ model, views }),
    '```',
    '',
    ...model.exclusions.map(
      (e) => `- ${e.scope} / ${e.kind} / ${e.state}: ${e.reason} (${e.evidence})`,
    ),
    ...model.questions.map((q) => `- ${q.id}: ${q.question} (${q.affects.join(', ')})`),
    C4_SECTION_END,
  ].join('\n');
}

export function projectC4Document(
  body: string,
  model: C4Model,
  views: string[],
  locale: string,
): string {
  return `${authoredBody(body)}\n\n${c4Section(model, views, locale)}\n`;
}
