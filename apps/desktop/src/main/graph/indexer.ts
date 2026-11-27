import { randomUUID } from 'node:crypto';
import type { Coverage, GraphSnapshot } from '@skaro/core/graph-view';
import { Facts, ANALYZER_VERSION } from './facts';
import { scan } from './source-policy';
import { GraphStore } from './store';
import { projectDocuments } from './projections/documents';
import { projectC4 } from './projections/c4';
import { hideInternalArtifacts } from './projections/visible-facts';
import { analyzeCompose } from './analyzers/compose';
import { analyzePython, PYTHON_AST_VERSION } from './analyzers/python';
import { analyzeTypescript } from './analyzers/typescript';
import { analyzeDjango } from './analyzers/django';
import { analyzePythonEvents } from './analyzers/python-events';
import { analyzePackages } from './analyzers/packages';

export interface IndexJob {
  projectId: string;
  root: string;
  database: string;
  generation: number;
  force?: boolean;
}
export async function buildIndex(
  job: IndexJob,
  progress: (done: number, total: number, stage: string) => void,
  signal: AbortSignal,
): Promise<GraphSnapshot> {
  const store = new GraphStore(job.database);
  try {
    progress(0, 1, 'scan');
    const manifest = await scan(job.root, (done, total) => progress(done, total, 'scan'), signal),
      current = store.current();
    if (
      !job.force &&
      current?.fingerprint === manifest.fingerprint &&
      current.analyzerVersion === ANALYZER_VERSION
    )
      return current;
    const facts = new Facts(manifest.checkoutId);
    const coverage: Coverage = {
      found: manifest.files.length + manifest.skipped.length,
      parsed: 0,
      reused: 0,
      skipped: manifest.skipped.length,
      errors: 0,
      unresolved: 0,
      languages: {},
      limitations: [
        'Static source analysis; no project code is executed.',
        'Reflection, dynamic imports/receivers, external dependencies and runtime conditions remain unresolved.',
        'HTTP/event candidates inferred by adapters do not prove dispatch, delivery, authorization or runtime success.',
      ],
      diagnostics: [],
    };
    const diagnostics = (path: string, message: string) => {
      coverage.errors++;
      if (coverage.diagnostics.length < 1000)
        coverage.diagnostics.push({ path, message: message.split(/\r?\n/)[0]!.slice(0, 500) });
      const language = manifest.files.find((file) => file.path === path)?.language ?? 'unknown';
      (coverage.languages[language] ??= { files: 0, parsed: 0, errors: 0 }).errors++;
    };
    for (const file of manifest.files) {
      facts.file(file);
      (coverage.languages[file.language] ??= { files: 0, parsed: 0, errors: 0 }).files++;
    }
    progress(0, manifest.files.length, 'documents');
    projectDocuments(manifest.files, facts, diagnostics);
    analyzePackages(manifest.files, facts, diagnostics);
    const model = projectC4(manifest.files, facts, diagnostics);
    progress(1, 5, 'python');
    const resolver = await analyzePython(manifest.files, facts, diagnostics, {
      read: <T>(path: string, hash: string) => store.cached<T>(path, hash, PYTHON_AST_VERSION),
      write: (path, hash, draft) => store.saveFile(path, hash, PYTHON_AST_VERSION, draft),
      reused: () => coverage.reused++,
    });
    progress(2, 5, 'frameworks');
    const routes = analyzeDjango(resolver, facts);
    analyzePythonEvents(resolver, facts);
    progress(3, 5, 'typescript');
    analyzeTypescript(manifest.root, manifest.files, facts, diagnostics, routes);
    for (const file of manifest.files.filter((file) => file.language === 'yaml')) {
      try {
        analyzeCompose(file, facts);
      } catch (error) {
        diagnostics(file.path, String(error));
      }
    }
    for (const [language, value] of Object.entries(coverage.languages)) {
      if (['typescript', 'svelte', 'python', 'markdown', 'yaml', 'json'].includes(language)) {
        value.parsed = manifest.files.filter(
          (file) =>
            file.language === language &&
            (language === 'yaml'
              ? /(^|\/)(?:docker-)?compose(?:\.[^/]+)?\.ya?ml$/.test(file.path)
              : language === 'json'
                ? file.path === '.skaro/c4/model.json' ||
                  /(^|\/)package\.json$/.test(file.path) ||
                  /(^|\/)tsconfig(?:\.[^/]+)?\.json$/.test(file.path)
                : true),
        ).length;
        coverage.parsed += value.parsed;
        if (value.parsed < value.files)
          coverage.limitations.push(
            `${language}: ${value.files - value.parsed} files have metadata only.`,
          );
      } else coverage.limitations.push(`${language}: file metadata only; no semantic analyzer.`);
    }
    hideInternalArtifacts(facts);
    coverage.unresolved = facts.unresolved.length;
    coverage.diagnostics.push(
      ...manifest.skipped.slice(0, Math.max(0, 1000 - coverage.diagnostics.length)),
    );
    progress(4, 5, 'verify');
    const verified = await scan(job.root, (done, total) => progress(done, total, 'verify'), signal);
    if (
      verified.fingerprint !== manifest.fingerprint ||
      verified.checkoutId !== manifest.checkoutId
    )
      throw new Error('graph-source-changed');
    const snapshot: GraphSnapshot = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId: job.projectId,
      checkoutId: manifest.checkoutId,
      generation: job.generation,
      root: manifest.root,
      fingerprint: manifest.fingerprint,
      head: manifest.head,
      analyzerVersion: ANALYZER_VERSION,
      createdAt: Date.now(),
      coverage,
      nodes: facts.nodes.size,
      edges: [...facts.edges.values()].filter(
        (edge) => facts.nodes.has(edge.source) && facts.nodes.has(edge.target),
      ).length,
      ...(model
        ? {
            c4Revision: model.revision,
            c4Hash: manifest.files.find((file) => file.path === '.skaro/c4/model.json')!.hash,
          }
        : {}),
    };
    progress(4, 5, 'persist');
    store.publish(snapshot, facts, model, () => signal.throwIfAborted());
    progress(5, 5, 'ready');
    return snapshot;
  } finally {
    store.close();
  }
}
