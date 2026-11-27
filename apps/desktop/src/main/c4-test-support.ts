import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ArtifactStore,
  applyC4Package,
  c4BodyHash,
  git,
  parseMarkdown,
  prepareC4Package,
  serializeMarkdown,
  setFields,
  type AppDb,
  type C4Model,
} from '@skaro/core';
import { C4Service } from './c4-service';
import { c4ChangeHash } from './c4-review';
import type { Projects } from './projects';

/** Architecture of the existing Git fixtures: text documents, with no application runtime. */
export async function prepareFixtureArchitecture(
  root: string,
  accepted: string[] = [],
): Promise<void> {
  const artifacts = await new ArtifactStore(root).load();
  const model: C4Model = {
    version: 1,
    revision: (artifacts.c4?.revision ?? 0) + 1,
    title: 'Document repository',
    elements: [
      {
        id: 'repository',
        kind: 'system',
        name: 'Document repository',
        description: 'Text files published and retained by the Git completion scenarios.',
        state: 'current',
        external: false,
        code: [],
        evidence: [
          '.skaro/: the fixture exercises persisted text documents, not an application runtime.',
        ],
        decisions: [],
      },
    ],
    relationships: [],
    views: [
      {
        id: 'context',
        kind: 'context',
        title: 'Repository context',
        scope: 'repository',
        state: 'current',
        elements: ['repository'],
        relationships: [],
        steps: [],
        instances: [],
      },
    ],
    specifications: [],
    exclusions: ['container', 'deployment'].map((kind) => ({
      kind: kind as 'container' | 'deployment',
      scope: 'repository',
      state: 'current',
      reason:
        'The existing Git fixture contains text documents and has no executable application or runtime deployment.',
      evidence: '.skaro/ and the text files written by the existing fixture.',
    })),
    questions: [],
  };
  const documents = [
    {
      path: 'architecture.md',
      content: '# Document repository\n\nGit publication of text files.\n',
    },
  ];
  for (const spec of artifacts.specs.filter(
    (s) => s.status === 'accepted' || accepted.includes(s.id),
  )) {
    const text = await readFile(join(root, spec.path), 'utf8');
    model.specifications.push({
      id: spec.id,
      path: spec.path.slice('.skaro/'.length),
      bodyHash: c4BodyHash(text),
      impact: 'uses',
      description: 'Planning and publication of documents in this isolated fixture.',
      elements: ['repository'],
      relationships: [],
      views: ['context'],
      requirements: [...new Set(spec.body.match(/\bR-\d+\b/g) ?? [])].map((id) => ({
        id,
        elements: ['repository'],
        relationships: [],
        views: ['context'],
      })),
    });
    if (accepted.includes(spec.id)) {
      const file = parseMarkdown(text);
      setFields(file, { status: 'accepted' });
      documents.push({ path: spec.path.slice('.skaro/'.length), content: serializeMarkdown(file) });
    }
  }
  const pkg = await prepareC4Package(root, {
    baseRevision: artifacts.c4?.revision ?? 0,
    model,
    locale: 'en',
    title: model.title,
    summary: 'Architecture of the existing isolated Git fixture.',
    documents,
  });
  await applyC4Package(root, pkg);
}

/** Explicitly perform the production review before an existing fixture submits its result. */
export async function reviewFixtureResult(
  db: AppDb,
  projects: Projects,
  projectId: string,
  taskId: string,
  runId: string,
): Promise<void> {
  const context = projects.get(projectId);
  context.invalidate();
  const artifacts = await context.load(true);
  const checkout = db.getRun(runId)?.worktree ?? context.root;
  const baseHead = (await git(checkout, ['rev-parse', artifacts.config.baseBranch])).stdout.trim();
  const service = new C4Service({
    db,
    projects,
    locale: () => 'en',
    publish: async () => undefined,
    changed: () => undefined,
    stageImport: async () => {
      throw new Error('This fixture does not exercise import');
    },
  });
  const result = await service.review(
    {
      revision: artifacts.c4!.revision,
      aligned: true,
      elements: ['repository'],
      relationships: [],
      realized: [],
      changeHash: await c4ChangeHash(checkout, baseHead),
      evidence: 'The current Git diff publishes text files within the documented repository.',
    },
    { kind: 'task', projectId, taskId, runId },
  );
  if (result.isError) throw new Error(result.text);
}
