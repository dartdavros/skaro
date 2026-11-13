import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import { c4Hash, git, readC4Documents } from '@skaro/core';
import type { C4Service } from './c4-service';
import { allowed, textSource } from './graph/source-policy';

export interface AuditSnapshot {
  fingerprint: string;
  files: { path: string; hash: string }[];
  complete: boolean;
  unresolved: boolean;
  context: string;
}
/** Fingerprints bind the declaration to actual files, including untracked non-ignored sources. */
export async function c4AuditSnapshot(
  root: string,
  c4: C4Service,
  project: string,
  chat: string,
): Promise<AuditSnapshot> {
  const context = await c4.context({ kind: 'project_chat', projectId: project, chatId: chat });
  const parsed = JSON.parse(context.text);
  const listed = await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const paths = new Set([
    ...listed.stdout.split('\0').filter(Boolean),
    ...[...(await readC4Documents(root))].map(([path]) => `.skaro/${path}`),
  ]);
  if (parsed.model) paths.add('.skaro/c4/model.json');
  const files: AuditSnapshot['files'] = [];
  let complete = true;
  const base = await realpath(root);
  for (const path of [...paths].sort()) {
    if (!allowed(path) || !textSource(path)) continue;
    if (files.length >= 5000) {
      complete = false;
      break;
    }
    const file = resolve(root, path);
    try {
      const rel = relative(base, await realpath(file));
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) {
        complete = false;
        continue;
      }
      if ((await stat(file)).size > 2 * 1024 * 1024) {
        complete = false;
        continue;
      }
      const bytes = await readFile(file);
      if (bytes.subarray(0, 8192).includes(0)) continue;
      files.push({
        path: path.replaceAll('\\', '/'),
        hash: createHash('sha256').update(bytes).digest('hex'),
      });
    } catch {
      complete = false;
    }
  }
  return {
    files,
    complete,
    fingerprint: c4Hash(
      JSON.stringify({ files, context: parsed.model, documents: parsed.documents, complete }),
    ),
    unresolved: !parsed.model || !!parsed.problems?.length,
    context: context.text,
  };
}
export function verifyAuditConclusion(snapshot: AuditSnapshot, args: Record<string, unknown>) {
  if (
    !['unchanged', 'partial'].includes(String(args.outcome)) ||
    typeof args.summary !== 'string' ||
    !args.summary.trim() ||
    args.summary.length > 4000
  )
    throw new Error('Audit requires an explicit outcome and a bounded summary');
  if (args.fingerprint !== snapshot.fingerprint)
    throw new Error('Audit inputs changed; read the current context and audit again');
  if (
    !Array.isArray(args.evidence) ||
    args.evidence.some((p) => typeof p !== 'string' || !snapshot.files.some((f) => f.path === p))
  )
    throw new Error('Audit evidence must identify actual source files');
  const covered = new Set(args.evidence);
  return {
    result:
      args.outcome === 'unchanged' &&
      snapshot.complete &&
      !snapshot.unresolved &&
      snapshot.files.every((f) => covered.has(f.path))
        ? ('unchanged' as const)
        : ('partial' as const),
    summary: args.summary,
    fingerprint: snapshot.fingerprint,
  };
}
