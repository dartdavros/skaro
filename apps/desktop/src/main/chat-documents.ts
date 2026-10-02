import type {
  ProposeAdrArgs,
  ProposeSpecArgs,
  SkaroScope,
  ToolResult,
  WriteDocArgs,
} from '@skaro/mcp-server';
import { headings } from './task-body';
import { currentDoc, sameText, adrId, nextNumber } from './chat-proposal-helpers';

import type { ChatEngine } from './chat-engine';

const DOC_PATH = /^(brief\.md|architecture\.md|docs\/[^/\\]+\.md)$/;
export class ChatDocuments {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  async writeDoc(args: WriteDocArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    if (!DOC_PATH.test(args.path)) {
      return {
        text: 'path must be brief.md, architecture.md or docs/<name>.md inside .skaro/.',
        isError: true,
      };
    }
    const context = this.ctx.project(live.projectId);
    const artifacts = await context.load();
    const before = await currentDoc(context, args.path);
    const after = `${args.content.replace(/\s+$/, '')}\n`;
    if (sameText(before, after)) {
      return { text: `.skaro/${args.path} already has this text; nothing changed.` };
    }
    const auto = artifacts.config.chat.autoAcceptDocs;
    if (auto) {
      await context.store.writeDoc(args.path, after);
      this.ctx.deps.db.addEvent(live.projectId, 'doc_updated', { path: args.path });
      context.invalidate();
      this.ctx.deps.emit('project.changed', { projectId: live.projectId });
    }
    this.ctx.proposals.addProposal(
      live,
      {
        type: 'doc',
        path: args.path,
        ...(before !== undefined ? { before } : {}),
        after,
        ...(args.summary ? { summary: args.summary } : {}),
      },
      auto ? 'applied' : 'pending',
    );
    return {
      text: auto
        ? `Skaro wrote .skaro/${args.path} (documents from the chat apply at once in this ` +
          'project). The user sees the change as a card and can roll it back.'
        : `The change to .skaro/${args.path} is shown to the user as a card and is applied only ` +
          'if the user accepts it. The decision comes with their next message; continue.',
    };
  }

  async proposeAdr(args: ProposeAdrArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    const artifacts = await this.ctx.project(live.projectId).load();
    let replaces: string | undefined;
    if (args.replaces) {
      replaces = adrId(args.replaces);
      if (!artifacts.adrs.some((a) => a.id === replaces)) {
        return { text: `There is no ADR ${args.replaces} to replace.`, isError: true };
      }
    }
    const pending = this.ctx.proposals
      .proposals(live)
      .filter((p) => p.proposal.type === 'adr').length;
    const id = String(
      nextNumber(
        artifacts.adrs.map((a) => a.id),
        /^(\d+)$/,
      ) + pending,
    ).padStart(4, '0');
    const h = headings(this.ctx.deps.locale());
    const body =
      `## ${h.context}\n\n${args.context}\n\n## ${h.decision}\n\n${args.decision}\n\n` +
      `## ${h.consequences}\n\n${args.consequences}\n`;
    this.ctx.proposals.addProposal(
      live,
      {
        type: 'adr',
        id,
        title: args.title,
        body,
        ...(replaces ? { replaces } : {}),
        ...(args.summary ? { summary: args.summary } : {}),
      },
      'pending',
    );
    return {
      text:
        `ADR "${args.title}" is shown to the user as a card (it becomes ADR-${id} if accepted ` +
        'now). The decision comes with their next message; continue.',
    };
  }

  async proposeSpec(args: ProposeSpecArgs, scope: SkaroScope): Promise<ToolResult> {
    const live = this.ctx.context.caller(scope);
    const context = this.ctx.project(live.projectId);
    const artifacts = await context.load();
    const content = `${args.content.replace(/\s+$/, '')}\n`;
    if (args.id) {
      const id = adrId(args.id);
      const spec = artifacts.specs.find((s) => s.id === id);
      if (!spec) return { text: `There is no specification ${args.id}.`, isError: true };
      if (sameText(spec.body, content)) {
        return { text: `SPEC-${id} already has this text; nothing changed.` };
      }
      const auto = artifacts.config.chat.autoAcceptDocs;
      if (auto) {
        await context.store.writeSpec(id, content);
        this.ctx.deps.db.addEvent(live.projectId, 'spec_updated', { id });
        context.invalidate();
        this.ctx.deps.emit('project.changed', { projectId: live.projectId });
      }
      this.ctx.proposals.addProposal(
        live,
        {
          type: 'spec_change',
          id,
          title: spec.title,
          before: spec.body,
          after: content,
          ...(args.summary ? { summary: args.summary } : {}),
        },
        auto ? 'applied' : 'pending',
      );
      return {
        text: auto
          ? `Skaro updated SPEC-${id} (documents from the chat apply at once in this project).`
          : `The change to SPEC-${id} is shown to the user as a card and is applied only if the ` +
            'user accepts it. The decision comes with their next message; continue.',
      };
    }
    let replaces: string | undefined;
    if (args.replaces) {
      replaces = adrId(args.replaces);
      if (!artifacts.specs.some((s) => s.id === replaces)) {
        return { text: `There is no specification ${args.replaces} to replace.`, isError: true };
      }
    }
    const pending = this.ctx.proposals
      .proposals(live)
      .filter((p) => p.proposal.type === 'spec').length;
    const id = String(
      nextNumber(
        artifacts.specs.map((s) => s.id),
        /^(\d+)$/,
      ) + pending,
    ).padStart(4, '0');
    const title = args.title ?? '';
    this.ctx.proposals.addProposal(
      live,
      {
        type: 'spec',
        id,
        title,
        body: content,
        ...(replaces ? { replaces } : {}),
        ...(args.summary ? { summary: args.summary } : {}),
      },
      'pending',
    );
    return {
      text:
        `Specification "${title}" is shown to the user as a card (it becomes SPEC-${id} if ` +
        'accepted now). The decision comes with their next message; continue. Cut its tasks ' +
        'after it is accepted and link them with "spec".',
    };
  }
}
