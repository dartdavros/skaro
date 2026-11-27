import {
  prepareC4Package,
  serializeMarkdown,
  parseMarkdown,
  setFields,
  slugify,
  type C4Package,
  type ProjectArtifacts,
} from '@skaro/core';
import type { ImportState } from './import-model';
import { docName } from './import-current';

/** Resolve the same numbers and source references as the native import before any writes. */
export async function prepareImportC4(
  root: string,
  artifacts: ProjectArtifacts,
  state: ImportState,
  picked: string[],
  locale: string,
): Promise<C4Package | undefined> {
  const chosen = state.staged.filter((s) => picked.includes(s.key));
  if (state.c4) {
    const shared = state.staged.filter((s) => ['architecture', 'spec', 'adr'].includes(s.type));
    if (!shared.some((s) => s.type === 'architecture' || s.type === 'spec'))
      throw new Error(
        'Stage architecture or specification documents so the owner can review the C4 model previews.',
      );
    const selected = shared.filter((s) => picked.includes(s.key));
    if (!selected.length) return undefined;
    if (selected.length !== shared.length)
      throw new Error(
        'C4 architecture, specifications and ADRs are one coherent package. Select all its related documents or leave the whole package unselected.',
      );
  }
  if (!state.c4) return undefined;
  const next = (ids: string[]) => Math.max(0, ...ids.map(Number)) + 1;
  let spec = next(artifacts.specs.map((s) => s.id)),
    adr = next(artifacts.adrs.map((s) => s.id));
  const ids = new Map<string, string>(),
    paths = new Map<string, string>();
  for (const item of chosen) {
    if (item.type !== 'spec' && item.type !== 'adr') continue;
    const id = item.updates ?? String(item.type === 'spec' ? spec++ : adr++).padStart(4, '0');
    ids.set(item.key, id);
    const existing = (item.type === 'spec' ? artifacts.specs : artifacts.adrs).find(
      (s) => s.id === id,
    );
    paths.set(
      item.key,
      existing?.path.replace(/^\.skaro\//, '') ??
        `${item.type === 'spec' ? 'specs' : 'adr'}/${id}-${slugify(item.title)}.md`,
    );
  }
  const replace = (text: string) =>
    text.replace(
      /(`+)[\s\S]*?\1|(~{3,})[^\n]*\n[\s\S]*?\2|\{\{\s*([\w.-]+)\s*\}\}/g,
      (all, code: string | undefined, fence: string | undefined, key: string | undefined) => {
        // Source documentation may explain {{key}} syntax in code; it is authored text.
        if (code || fence || !key) return all;
        const id = ids.get(key);
        const item = chosen.find((s) => s.key === key);
        if (!id || !item)
          throw new Error(`C4 import depends on unselected or unknown source artifact ${key}`);
        return `${item.type === 'spec' ? 'SPEC' : 'ADR'}-${id}`;
      },
    );
  const documents = chosen
    .filter((s) => ['brief', 'architecture', 'doc', 'spec', 'adr'].includes(s.type))
    .map((s) => {
      let path = s.type === 'doc' ? `docs/${docName(s)}` : `${s.type}.md`;
      let content = replace(s.body);
      if (s.type === 'spec' || s.type === 'adr') {
        path = paths.get(s.key)!;
        const parsed = parseMarkdown(content);
        setFields(parsed, {
          id: ids.get(s.key)!,
          title: s.title,
          status: s.status ?? 'accepted',
          date: new Date().toISOString().slice(0, 10),
        });
        content = serializeMarkdown(parsed);
      }
      return { path, content };
    });
  const raw = structuredClone(state.c4.model) as {
    specifications?: { id: string; path: string }[];
    elements?: { decisions: string[] }[];
    relationships?: { decisions: string[] }[];
  };
  // Bindings may use the staged key until the service assigns the final number/path.
  for (const binding of raw.specifications ?? []) {
    if (ids.has(binding.id)) {
      binding.path = paths.get(binding.id)!;
      binding.id = ids.get(binding.id)!;
    }
    if (
      !artifacts.specs.some((s) => s.id === binding.id) &&
      ![...ids.values()].includes(binding.id)
    )
      throw new Error(`C4 import references an unselected specification ${binding.id}`);
  }
  for (const entry of [...(raw.elements ?? []), ...(raw.relationships ?? [])])
    entry.decisions = entry.decisions.map((id) => ids.get(id) ?? id);
  return prepareC4Package(root, {
    ...state.c4,
    model: raw,
    documents: [...state.c4.documents, ...documents],
    locale,
  });
}
