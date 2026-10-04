import type { ArtifactStore, ProjectArtifacts } from '@skaro/core';
import type { Applied, StagedArtifact, StagedType } from './import-model';
import { ChangedOnDisk, currentText, docName, pathOf, sameText } from './import-current';

/**
 * Writes the picked artifacts. Numbers are given first (the store numbers ADRs, specifications,
 * milestones and tasks in order), so {{key}} in any text and the keys in task fields become the
 * real ids; links to artifacts that were not picked are left out.
 */
export async function applyImport(
  store: ArtifactStore,
  artifacts: ProjectArtifacts,
  staged: StagedArtifact[],
  picked: string[],
  progress: (done: number, total: number) => void = () => undefined,
): Promise<Applied> {
  const chosen = staged.filter((s) => picked.includes(s.key));
  const byKey = new Map(staged.map((s) => [s.key, s]));

  // Updates first check that nothing changed on disk since the agent staged them.
  for (const s of chosen) {
    if (!s.updates && s.type !== 'brief' && s.type !== 'architecture') continue;
    const now = currentText(artifacts, s);
    if (s.before !== undefined && now !== undefined && !sameText(now, s.before)) {
      throw new ChangedOnDisk(pathOf(artifacts, s));
    }
  }

  const next = (ids: string[], pattern: RegExp) =>
    Math.max(0, ...ids.map((id) => Number(pattern.exec(id)?.[1] ?? 0))) + 1;
  let adr = next(
    artifacts.adrs.map((a) => a.id),
    /^(\d+)$/,
  );
  let spec = next(
    artifacts.specs.map((s) => s.id),
    /^(\d+)$/,
  );
  let milestone = next(
    artifacts.milestones.map((m) => m.id),
    /^M(\d+)$/,
  );
  let task = next(
    artifacts.tasks.map((t) => t.id),
    /^T-(\d+)$/,
  );
  const ids = new Map<string, string>();
  const codes = new Map<string, string>();
  for (const s of chosen) {
    if (s.type === 'adr') {
      const id = s.updates ?? String(adr++).padStart(4, '0');
      ids.set(s.key, id);
      codes.set(s.key, `ADR-${id}`);
    } else if (s.type === 'spec') {
      const id = s.updates ?? String(spec++).padStart(4, '0');
      ids.set(s.key, id);
      codes.set(s.key, `SPEC-${id}`);
    } else if (s.type === 'milestone') {
      const id = `M${String(milestone++).padStart(2, '0')}`;
      ids.set(s.key, id);
      codes.set(s.key, id);
    } else if (s.type === 'task') {
      const id = `T-${String(task++).padStart(3, '0')}`;
      ids.set(s.key, id);
      codes.set(s.key, id);
    }
  }

  const dropped: string[] = [];
  const text = (body: string, owner: StagedArtifact) =>
    body.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key: string) => {
      const code = codes.get(key);
      if (code) return code;
      const other = byKey.get(key);
      if (other) dropped.push(`${owner.title} → ${other.title}`);
      return other ? `«${other.title}»` : key;
    });
  /** A task field: a staged key when picked, an existing id as it is, else nothing. */
  const ref = (value: string | undefined, owner: StagedArtifact): string | undefined => {
    if (!value) return undefined;
    if (ids.has(value)) return ids.get(value);
    const other = byKey.get(value);
    if (other) {
      dropped.push(`${owner.title} → ${other.title}`);
      return undefined;
    }
    return value;
  };

  const imported: Applied['imported'] = [];
  const order: StagedType[] = ['brief', 'architecture', 'doc', 'adr', 'spec', 'milestone', 'task'];
  const sorted = [...chosen].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  let done = 0;
  for (const s of sorted) {
    progress(done++, sorted.length);
    const body = text(s.body, s);
    switch (s.type) {
      case 'brief':
      case 'architecture': {
        const update =
          (s.type === 'brief' ? artifacts.brief : artifacts.architecture) !== undefined;
        await store.writeDoc(`${s.type}.md`, body);
        imported.push({ kind: s.type, title: s.title, update });
        break;
      }
      case 'doc': {
        const name = docName(s);
        const update = artifacts.docs.some((d) => d.path === `.skaro/docs/${name}`);
        await store.writeDoc(`docs/${name}`, body);
        imported.push({ kind: 'doc', title: name, update });
        break;
      }
      case 'adr': {
        if (s.updates) await store.writeAdr(s.updates, body);
        else {
          await store.createAdr({ title: s.title, body, status: s.status ?? 'accepted' });
        }
        imported.push({ kind: 'adr', code: codes.get(s.key), title: s.title, update: !!s.updates });
        break;
      }
      case 'spec': {
        if (s.updates) await store.writeSpec(s.updates, body);
        else await store.createSpec({ title: s.title, body, status: s.status ?? 'accepted' });
        imported.push({
          kind: 'spec',
          code: codes.get(s.key),
          title: s.title,
          update: !!s.updates,
        });
        break;
      }
      case 'milestone': {
        await store.createMilestone({ title: s.title, body });
        imported.push({ kind: 'plan', code: codes.get(s.key), title: s.title, update: false });
        break;
      }
      case 'task': {
        const inMilestone = ref(s.milestone, s);
        const specId = ref(s.spec, s);
        await store.createTask({
          title: s.title,
          body,
          ...(inMilestone ? { milestone: inMilestone } : {}),
          ...(specId ? { spec: specId } : {}),
        });
        imported.push({ kind: 'plan', code: codes.get(s.key), title: s.title, update: false });
        break;
      }
    }
  }
  // Dependencies once every picked task has its id.
  for (const s of sorted.filter((x) => x.type === 'task')) {
    const deps = (s.dependsOn ?? []).map((d) => ref(d, s)).filter((d): d is string => !!d);
    if (deps.length) await store.updateTask(ids.get(s.key)!, { dependsOn: deps });
  }
  progress(sorted.length, sorted.length);
  return { imported, dropped: [...new Set(dropped)] };
}
