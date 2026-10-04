import type {
  FinishImportArgs,
  StageArtifactArgs,
  SkaroScope,
  ToolResult,
} from '@skaro/mcp-server';
import {
  currentText,
  docName,
  importGroups,
  loadManifest,
  saveState,
  type StagedArtifact,
} from './imports';
import { milestoneBody } from './plan';
import { taskBody } from './task-body';
import { importLinks } from './chat-import-helpers';
import { currentTurn } from './chat-settings-helpers';
import { adrId } from './chat-proposal-helpers';

import type { ChatEngine } from './chat-engine';

export class ChatImportStage {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  async stageArtifact(args: StageArtifactArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    const state = await this.ctx.importReview.importOf(live.chat.id);
    const artifacts = await this.ctx.project(live.projectId).load();
    const locale = this.ctx.deps.locale();
    const words = this.ctx.importReview.importText();
    let staged: StagedArtifact;
    const base = {
      key: args.key,
      type: args.type,
      sources: args.sources,
      ...(args.status ? { status: args.status } : {}),
    };
    switch (args.type) {
      case 'brief':
      case 'architecture': {
        const exists =
          (args.type === 'brief' ? artifacts.brief : artifacts.architecture) !== undefined;
        staged = {
          ...base,
          title: args.type === 'brief' ? words.brief : words.architecture,
          body: args.body ?? '',
          ...(exists ? { updates: `${args.type}.md` } : {}),
        };
        break;
      }
      case 'doc': {
        const name = docName({
          ...base,
          title: args.name ?? args.updates ?? args.title ?? '',
          body: '',
        });
        const exists = artifacts.docs.some((d) => d.path === `.skaro/docs/${name}`);
        staged = {
          ...base,
          title: name,
          name,
          body: args.body ?? '',
          ...(exists ? { updates: name } : {}),
        };
        break;
      }
      case 'adr':
      case 'spec': {
        let updates: string | undefined;
        if (args.updates) {
          updates = adrId(args.updates);
          const list = args.type === 'adr' ? artifacts.adrs : artifacts.specs;
          if (!list.some((x) => x.id === updates)) {
            return {
              text: `There is no ${args.type === 'adr' ? 'ADR' : 'specification'} ${args.updates} to update.`,
              isError: true,
            };
          }
        }
        staged = {
          ...base,
          title: args.title ?? '',
          body: args.body ?? '',
          ...(updates ? { updates } : {}),
        };
        break;
      }
      case 'milestone':
        staged = {
          ...base,
          title: args.title ?? '',
          body: milestoneBody(
            { title: args.title ?? '', goal: args.goal ?? '', criteria: args.doneWhen ?? '' },
            locale,
          ),
        };
        break;
      case 'task':
        staged = {
          ...base,
          title: args.title ?? '',
          body: taskBody(
            {
              goal: args.goal ?? '',
              criteria: args.criteria ?? [],
              ...(args.notes ? { notes: args.notes } : {}),
            },
            locale,
          ),
          ...(args.milestone ? { milestone: args.milestone } : {}),
          ...(args.dependsOn?.length ? { dependsOn: args.dependsOn } : {}),
          ...(args.spec ? { spec: args.spec } : {}),
        };
        break;
    }
    const before = currentText(artifacts, staged);
    if (staged.updates && before !== undefined) staged.before = before;
    const replaced = state.staged.some((s) => s.key === args.key);
    state.staged = [...state.staged.filter((s) => s.key !== args.key), staged];
    await saveState(state);
    return {
      text:
        `${replaced ? 'Replaced' : 'Staged'} ${args.type} "${staged.title}" as ${args.key}` +
        `${staged.updates ? ` (changes ${staged.updates})` : ''}. ${state.staged.length} staged.`,
    };
  }

  async finishImport(args: FinishImportArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    const state = await this.ctx.importReview.importOf(live.chat.id);
    if (!state.staged.length) {
      return { text: 'Nothing is staged yet; stage the artifacts first.', isError: true };
    }
    const artifacts = await this.ctx.project(live.projectId).load();
    const problems = importLinks(state.staged, artifacts);
    if (problems.length) return { text: problems.join('\n'), isError: true };
    const manifest = await loadManifest(state.dir);
    const skipped = [
      ...(manifest?.files ?? [])
        .filter((f) => f.action === 'skipped')
        .map((f) => ({ path: f.source, reason: f.reason ?? '' })),
      ...args.skipped,
    ];
    state.report = { skipped, notes: args.notes };
    await saveState(state);
    this.ctx.history.skaroEvent(live, {
      t: 'item.upsert',
      item: {
        id: `skaro-import-${state.id}`,
        turnId: currentTurn(live),
        kind: 'proposal',
        proposal: {
          type: 'import',
          id: state.id,
          groups: importGroups(state.staged),
          total: state.staged.length,
          skipped: skipped.length,
          notes: args.notes.length,
        },
        state: 'pending',
        status: 'done',
        startedAt: Date.now(),
        native: { agent: 'skaro', type: 'proposal', ref: 'import' },
      },
    });
    return {
      text:
        `The import is shown to the user as the "Import is ready" card with ${state.staged.length} ` +
        'artifacts; the user reviews and applies what they pick. The decision comes with their ' +
        'next message. Tell the user in one or two sentences what you carried over.',
    };
  }
}
