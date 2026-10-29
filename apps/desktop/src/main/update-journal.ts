import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentId, Platform } from '@skaro/core';
import { parseRelease, type ReleaseManifest } from './update-release';
import { backupApplication } from './update-backup';

export interface PendingUpdate {
  manifest: ReleaseManifest;
  agents: AgentId[];
  files: string[];
  applying: boolean;
  backup?: string;
}

/** A failed update retains its payload, previous app, old agents and journal for recovery. */
export class UpdateJournal {
  readonly dir: string;
  constructor(dir: string) {
    this.dir = dir;
  }
  async read(): Promise<PendingUpdate | undefined> {
    let text: string;
    try {
      text = await readFile(join(this.dir, 'pending.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    const pending = JSON.parse(text) as PendingUpdate;
    parseRelease(pending.manifest);
    if (
      !Array.isArray(pending.agents) ||
      pending.agents.some((id) => id !== 'codex' && id !== 'claude-code') ||
      !Array.isArray(pending.files) ||
      pending.files.some((file) => typeof file !== 'string' || !isAbsolute(file)) ||
      typeof pending.applying !== 'boolean'
    )
      throw new Error('Invalid pending update journal');
    return pending;
  }
  async save(value: PendingUpdate): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const temporary = join(this.dir, `pending-${randomUUID()}.json`);
    await writeFile(temporary, JSON.stringify(value));
    await rename(temporary, join(this.dir, 'pending.json'));
  }
  async confirm(value: PendingUpdate): Promise<void> {
    await rename(
      join(this.dir, 'pending.json'),
      join(this.dir, `applied-${value.manifest.bundleVersion}-${randomUUID()}.json`),
    );
  }
  /** Keeps a download overtaken by a newer installation for diagnostics only. */
  async retire(value: PendingUpdate): Promise<void> {
    await rename(
      join(this.dir, 'pending.json'),
      join(this.dir, `superseded-${value.manifest.bundleVersion}-${randomUUID()}.json`),
    );
  }
  async backup(version: string, executable: string, platform: Platform): Promise<string> {
    return backupApplication(this.dir, version, executable, platform);
  }
}
