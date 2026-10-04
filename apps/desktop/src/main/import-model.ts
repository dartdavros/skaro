import type { ImportKind } from '@skaro/timeline';

export type SourceKind = 'folder' | 'file' | 'archive';

/** What the import modal says about a source before the import starts. */
export interface SourceInfo {
  path: string;
  /** "~/Docs/shop" */
  display: string;
  kind: SourceKind;
  files: number;
  readable: number;
  unsupported: number;
  /** Extensions of the files that are not read: ".vsdx". */
  formats: string[];
  missing?: boolean;
}

export interface ManifestFile {
  /** As the user knows it: "~/Docs/shop/architecture.pdf", "~/Docs/old.zip/specs/a.md". */
  source: string;
  /** The copy the agent reads, relative to the import folder. */
  copy?: string;
  /** The original of a converted file (pdf), relative to the import folder. */
  original?: string;
  format: string;
  size: number;
  /** The file on disk, to open from the review screen; none inside an archive. */
  origin?: string;
  action: 'copied' | 'converted' | 'skipped';
  reason?: string;
}

export interface Manifest {
  sources: { path: string; display: string; kind: SourceKind }[];
  files: ManifestFile[];
}

export type StagedType = 'brief' | 'architecture' | 'adr' | 'spec' | 'doc' | 'milestone' | 'task';

/** An artifact the import agent staged; nothing of it is in .skaro/ yet. */
export interface StagedArtifact {
  /** The agent's key: other staged artifacts refer to it as {{key}} or in fields. */
  key: string;
  type: StagedType;
  title: string;
  body: string;
  /** Manifest sources it comes from, or "code" for the project's code. */
  sources: string[];
  /** An existing artifact it changes: ADR or specification number, document name. */
  updates?: string;
  /** Status of an ADR or a specification (accepted by default: it is a decision already made). */
  status?: 'proposed' | 'accepted' | 'superseded';
  /** Task: milestone key or id, dependencies (keys or ids), specification (key or number). */
  milestone?: string;
  dependsOn?: string[];
  spec?: string;
  /** Document file name: "glossary.md". */
  name?: string;
  /** Text now, for an update: the review shows the diff and applying checks it did not change. */
  before?: string;
}

export interface ImportReport {
  skipped: { path: string; reason: string }[];
  notes: string[];
}

export interface ImportState {
  id: string;
  /** Absolute folder of the import in the app data. */
  dir: string;
  sources: SourceInfo[];
  staged: StagedArtifact[];
  report?: ImportReport;
}

// ── applying ─────────────────────────────────────────────────────────────────

export interface Applied {
  imported: { kind: ImportKind; code?: string; title: string; update: boolean }[];
  /** Links to artifacts that were not picked, left out. */
  dropped: string[];
}
