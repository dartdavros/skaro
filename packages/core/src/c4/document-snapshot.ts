import type { C4DocumentSnapshot } from './document-model.ts';
import { C4_MODEL_PATH } from './model.ts';
import { authoredBody } from './render.ts';
import { parseMarkdown } from '../artifacts/frontmatter.ts';
import { readC4File, withC4Lock } from './io.ts';
import { readC4Model } from './shape.ts';
import { recoverC4Transaction } from './transaction.ts';

/** Only specifications carry their explicitly linked C4 views. */
export function readC4DocumentSnapshot(root: string, path: string): Promise<C4DocumentSnapshot> {
  return withC4Lock(root, async () => {
    await recoverC4Transaction(root);
    const source = await readC4File(root, path);
    if (source === null) throw new Error(`Missing document ${path}`);
    const body = authoredBody(parseMarkdown(source).body);
    if (!path.startsWith('specs/')) return { body };
    const raw = await readC4File(root, C4_MODEL_PATH);
    if (raw === null) return { body };
    const model = readC4Model(JSON.parse(raw));
    const views = model.specifications.find((spec) => spec.path === path)?.views ?? [];
    return { body, ...(views.length ? { attachment: { model, views } } : {}) };
  });
}
