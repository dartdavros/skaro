import { type ProposalResult } from '@skaro/timeline';
import type { ImportReview } from '../shared/ipc';
import {
  applyImport,
  ChangedOnDisk,
  loadManifest,
  loadState,
  removeImport,
  type ImportState,
} from './imports';
import type { ProjectContext } from './projects';
import { LiveChat } from './chat-model';
import { importKey, type ImportWords, IMPORT_RU, IMPORT_EN, fieldsOf } from './chat-import-helpers';

import type { ChatEngine } from './chat-engine';
import { serializeTaskMutation } from './project-task-mutations';
import { prepareImportC4 } from './c4-import';
import { saveState } from './imports';
import { c4ImportBody, c4ImportRefs, c4ImportAttachment } from './c4-import-preview';
import { authoredBody } from '@skaro/core';

export class ChatImportReview {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  /** What the import agent staged, for the review screen. */
  async importReview(projectId: string, chatId: string): Promise<ImportReview> {
    await this.ctx.history.restore(projectId, chatId);
    const state = await this.importOf(chatId);
    const keys = new Set(state.staged.map((s) => s.key));
    const artifacts = await this.ctx.project(projectId).load();
    let next =
      Math.max(0, ...artifacts.milestones.map((m) => Number(/^M(\d+)$/.exec(m.id)?.[1] ?? 0))) + 1;
    const milestones: Record<string, string> = {};
    for (const s of state.staged.filter((x) => x.type === 'milestone')) {
      milestones[s.key] = `M${String(next++).padStart(2, '0')}`;
    }
    return {
      c4: c4ImportAttachment(state, artifacts),
      milestones,
      items: state.staged.map((s) => ({
        key: s.key,
        type: s.type,
        title: s.title,
        update: !!s.updates,
        sources: s.sources,
        body: c4ImportBody(state, s, artifacts),
        ...(s.before !== undefined ? { before: authoredBody(s.before) } : {}),
        ...(s.milestone ? { milestone: s.milestone } : {}),
        dependsOn: s.dependsOn ?? [],
        ...(s.spec ? { spec: s.spec } : {}),
        ...(s.type === 'task' || s.type === 'milestone' ? { fields: fieldsOf(s) } : {}),
        refs: [
          ...new Set(
            [
              ...[...s.body.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]!),
              s.milestone ?? '',
              s.spec ?? '',
              ...(s.dependsOn ?? []),
              ...c4ImportRefs(state, s),
            ].filter((k) => keys.has(k) && k !== s.key),
          ),
        ],
      })),
      skipped: state.report?.skipped ?? [],
      notes: state.report?.notes ?? [],
    };
  }

  async applyImportProposal(
    live: LiveChat,
    context: ProjectContext,
    picked: string[] | undefined,
  ): Promise<{ result: ProposalResult; note: string }> {
    const state = await this.importOf(live.chat.id);
    if (!state.report)
      throw new Error(
        'Import was changed after its last preparation. Finish and review it again before applying.',
      );
    const keys = picked ?? state.staged.map((s) => s.key);
    if (!keys.length) throw new Error('Nothing is selected');
    let applied;
    try {
      const artifacts = await context.load();
      const allSelected = state.staged.every((s) => keys.includes(s.key));
      const architecture =
        allSelected && state.c4Package
          ? state.c4Package
          : await prepareImportC4(context.root, artifacts, state, keys, this.ctx.deps.locale());
      if (architecture) {
        state.c4Package = architecture;
        await saveState(state);
      }
      applied = await serializeTaskMutation(context, async () =>
        applyImport(
          context.store,
          await context.load(),
          state.staged,
          keys,
          (done, total) =>
            this.ctx.deps.emit('import.progress', {
              projectId: live.projectId,
              chatId: live.chat.id,
              done,
              total,
            }),
          architecture,
        ),
      );
    } catch (error) {
      if (error instanceof ChangedOnDisk)
        throw new Error(`changed-on-disk:${error.path}`, { cause: error });
      throw error;
    }
    this.ctx.deps.db.addEvent(live.projectId, 'import_applied', {
      count: keys.length,
      total: state.staged.length,
    });
    await removeImport(state.dir);
    this.ctx.deps.emit('project.changed', { projectId: live.projectId });
    const skipped = state.staged.filter((s) => !keys.includes(s.key));
    const note = [
      `The user imported ${keys.length} of ${state.staged.length}: ` +
        applied.imported
          .map((i) => (i.code ? `${i.code} "${i.title}"` : `"${i.title}"`))
          .join(', ') +
        '.',
      skipped.length ? `Not taken: ${skipped.map((s) => `"${s.title}"`).join(', ')}.` : '',
      applied.dropped.length ? `Links left out: ${applied.dropped.join('; ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
    return { result: { imported: applied.imported, applied: keys.length }, note };
  }

  /** "Открыть исходный файл": the source on disk; a file inside an archive opens the archive. */
  async openImportSource(projectId: string, chatId: string, source: string): Promise<string> {
    await this.ctx.history.restore(projectId, chatId);
    const state = await this.importOf(chatId);
    const manifest = await loadManifest(state.dir);
    const file = manifest?.files.find((f) => f.source === source);
    if (file?.origin) return file.origin;
    const root = manifest?.sources.find(
      (s) => source === s.display || source.startsWith(`${s.display}/`),
    );
    if (!root) throw new Error(`unknown source ${source}`);
    return root.path;
  }

  importRecord(chatId: string): { id: string; dir: string } | undefined {
    return (
      this.ctx.deps.db.getSetting<{ id: string; dir: string } | null>(importKey(chatId), null) ??
      undefined
    );
  }

  async importOf(chatId: string): Promise<ImportState> {
    const record = this.importRecord(chatId);
    const state = record ? await loadState(record.dir) : undefined;
    if (!state) throw new Error('The import is no longer available');
    return state;
  }

  importText(): ImportWords {
    return this.ctx.deps.locale() === 'ru' ? IMPORT_RU : IMPORT_EN;
  }
}
