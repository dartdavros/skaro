import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { ArtifactStore, c4Hash, parseMarkdown, type C4Model } from '@skaro/core';
import { prepareImportC4 } from './c4-import';
import { c4ImportBody, c4ImportRefs, c4ImportAttachment } from './c4-import-preview';
import { c4CoverageProblems, c4ChangeHash } from './c4-review';
import type { ImportState } from './import-model';

const root = process.env['SKARO_C4_VERIFY_ROOT'];

// The input is the real accepted Skaro architecture/specification in the managed checkout.
it.skipIf(!root)(
  'prepares the actual documents as an import package without writing before acceptance',
  async () => {
    const artifacts = await new ArtifactStore(root!).load();
    expect(artifacts.c4Problems).toEqual([]);
    const model = structuredClone(artifacts.c4!);
    model.revision++;
    const architecture = await readFile(`${root}/.skaro/architecture.md`, 'utf8');
    const spec = artifacts.specs.find((s) => s.id === '0001')!;
    const state: ImportState = {
      id: 'skaro-c4-documents',
      dir: `${root}/output`,
      sources: [],
      staged: [
        {
          key: 'architecture',
          type: 'architecture',
          title: 'Архитектура',
          body: parseMarkdown(architecture).body,
          sources: ['docs/architecture.md'],
          updates: 'architecture.md',
        },
        {
          key: 'specification',
          type: 'spec',
          title: spec.title,
          body: spec.body,
          updates: spec.id,
          status: spec.status,
          sources: ['docs/c4/specification.md'],
        },
      ],
      c4: {
        title: 'C4 Skaro',
        summary: 'Согласованный импорт документов Skaro',
        baseRevision: artifacts.c4!.revision,
        model,
        documents: [],
      },
    };
    const before = await readFile(`${root}/.skaro/c4/model.json`, 'utf8');
    state.c4Package = await prepareImportC4(
      root!,
      artifacts,
      state,
      ['architecture', 'specification'],
      'ru',
    );
    const after = JSON.parse(
      state.c4Package!.files.find((f) => f.path === 'c4/model.json')!.after,
    ) as C4Model;
    expect(after.specifications[0]!.id).toBe(spec.id);
    expect(c4ImportBody(state, state.staged[0]!, artifacts)).not.toContain('```skaro-c4');
    expect(c4ImportBody(state, state.staged[1]!, artifacts)).not.toContain('```skaro-c4');
    expect(c4ImportAttachment(state, artifacts)?.model.revision).toBe(model.revision);
    expect(c4ImportAttachment(state, artifacts)?.views['specification']).toEqual(
      model.specifications[0]!.views,
    );
    expect(c4ImportRefs(state, state.staged[1]!)).toEqual(['architecture']);
    expect(await readFile(`${root}/.skaro/c4/model.json`, 'utf8')).toBe(before);
    await expect(prepareImportC4(root!, artifacts, state, ['specification'], 'ru')).rejects.toThrow(
      'one coherent package',
    );
    expect(await prepareImportC4(root!, artifacts, state, [], 'ru')).toBeUndefined();
    delete state.c4;
    await expect(prepareImportC4(root!, artifacts, state, ['specification'], 'ru')).rejects.toThrow(
      'without C4',
    );
  },
);

it.skipIf(!root)(
  'rejects an outdated architectural review and fingerprints the actual Git checkout',
  async () => {
    const artifacts = await new ArtifactStore(root!).load();
    const model = artifacts.c4!;
    const review = {
      revision: model.revision,
      aligned: true,
      changeHash: c4Hash(''),
      elements: ['c4service'],
      relationships: ['model'],
      realized: [],
      evidence: 'apps/desktop/src/main/c4-service.ts composes prepareC4Package and applyC4Package',
    };
    expect(c4CoverageProblems(artifacts, '', review)).toEqual([]);
    expect(
      c4CoverageProblems(artifacts, '', { ...review, revision: model.revision - 1 }).join('\n'),
    ).toContain('changed after review');
    expect(
      c4CoverageProblems(artifacts, '', { ...review, realized: ['c4service'] }).join('\n'),
    ).toContain('reviewed planned change');
    const hash = await c4ChangeHash(root!, 'HEAD');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(await c4ChangeHash(root!, 'HEAD')).toBe(hash);
  },
);
