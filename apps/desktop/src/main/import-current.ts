import type { ProjectArtifacts } from '@skaro/core';
import type { StagedArtifact } from './import-model';

export class ChangedOnDisk extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`${path} changed on disk`);
    this.path = path;
  }
}

export function docName(s: StagedArtifact): string {
  const raw = (s.updates ?? s.name ?? s.title).replace(/\.md$/i, '');
  const clean = raw
    .toLowerCase()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${clean || 'document'}.md`;
}

/** Text the artifact has in .skaro/ now, for an update. */
export function currentText(artifacts: ProjectArtifacts, s: StagedArtifact): string | undefined {
  switch (s.type) {
    case 'brief':
      return artifacts.brief?.body;
    case 'architecture':
      return artifacts.architecture?.body;
    case 'doc':
      return artifacts.docs.find((d) => d.path === `.skaro/docs/${docName(s)}`)?.body;
    case 'adr':
      return s.updates ? artifacts.adrs.find((a) => a.id === s.updates)?.body : undefined;
    case 'spec':
      return s.updates ? artifacts.specs.find((x) => x.id === s.updates)?.body : undefined;
    default:
      return undefined;
  }
}

export function pathOf(artifacts: ProjectArtifacts, s: StagedArtifact): string {
  switch (s.type) {
    case 'brief':
      return '.skaro/brief.md';
    case 'architecture':
      return '.skaro/architecture.md';
    case 'doc':
      return `.skaro/docs/${docName(s)}`;
    case 'adr':
      return artifacts.adrs.find((a) => a.id === s.updates)?.path ?? '.skaro/adr/';
    case 'spec':
      return artifacts.specs.find((x) => x.id === s.updates)?.path ?? '.skaro/specs/';
    default:
      return '.skaro/';
  }
}

export function sameText(a: string, b: string): boolean {
  return a.replace(/\s+$/, '') === b.replace(/\s+$/, '');
}
