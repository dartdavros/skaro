import { readC4Documents } from './project.ts';
import { C4_MODEL_PATH } from './model.ts';
import { readC4File, withC4Lock } from './io.ts';
import { readC4Model } from './shape.ts';
import { authoredBody } from './render.ts';
import { prepareC4Package } from './package.ts';

/** An explicit owner-reviewed format migration. Never run as a side effect of opening a project. */
export async function prepareC4DocumentMigration(root: string, locale: string) {
  const source = await withC4Lock(root, async () => {
    const raw = await readC4File(root, C4_MODEL_PATH);
    if (raw === null) throw new Error('C4 model is required before document migration');
    const model = readC4Model(JSON.parse(raw));
    const documents = [...(await readC4Documents(root))]
      .filter(([, text]) => /<!-- skaro:c4:start -->/.test(text))
      .map(([path, text]) => ({ path, content: authoredBody(text) + '\n' }));
    return { model, documents };
  });
  if (!source.documents.length) return undefined;
  const ru = locale === 'ru';
  return prepareC4Package(root, {
    title: ru ? 'Хранить C4 отдельно от документов' : 'Store C4 separately from documents',
    summary: ru
      ? 'Удалить устаревшие встроенные копии C4. Авторский текст, архитектурные объекты и покрытие требований сохраняются. Источник модели — c4/model.json.'
      : 'Remove legacy embedded C4 copies. Authored text, architecture objects and requirement coverage are preserved. The model source is c4/model.json.',
    baseRevision: source.model.revision,
    model: { ...source.model, revision: source.model.revision + 1 },
    documents: source.documents,
    locale,
  });
}
