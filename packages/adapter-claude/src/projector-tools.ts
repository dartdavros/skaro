import { arr, bool, countDiff, num, obj, str, type ItemStatus, type Obj } from '@skaro/timeline';
import {
  AGENT,
  PLAN_TOOLS,
  type ToolItem,
  toolBody,
  resultText,
  imageBlock,
  patchFromStructured,
} from './projector-helpers.ts';
import type { ClaudeProjectionState } from './projector-state.ts';

export class ClaudeToolsProjection {
  private readonly state: ClaudeProjectionState;
  constructor(state: ClaudeProjectionState) {
    this.state = state;
  }
  onToolUse(block: Obj, parentId: string | undefined): void {
    const id = str(block['id']) ?? '';
    const name = str(block['name']) ?? '';
    const input = obj(block['input']) ?? {};
    const native = { agent: AGENT, type: `tool_use.${name}`, ref: id };

    if (PLAN_TOOLS.has(name)) {
      this.state.planProjection.onPlanTool(id, name, input);
      return;
    }
    if (name === 'AskUserQuestion') return; // shown as a question interaction
    if (name === 'ToolSearch') return; // loads deferred tools: housekeeping, raw log only
    if (name === 'ExitPlanMode') {
      const plan = str(input['plan']);
      if (plan)
        this.state.upsert({
          id,
          parentId,
          kind: 'message',
          role: 'agent',
          text: plan,
          phase: 'plan',
          status: 'done',
          native,
        });
      return;
    }

    const body = toolBody(name, input);
    this.state.upsert({
      id,
      parentId,
      ...body,
      status: 'running',
      native,
      toolName: name,
    } as ToolItem);
  }

  onToolResults(msg: Obj): void {
    const content = arr(obj(msg['message'])?.['content']);
    const structured = obj(msg['tool_use_result']);
    for (const raw of content) {
      const block = obj(raw);
      if (block?.['type'] !== 'tool_result') continue;
      const toolUseId = str(block['tool_use_id']) ?? '';
      const isError = bool(block['is_error']) ?? false;
      const text = resultText(block['content']);

      const pendingTask = this.state.pendingTaskCreate.get(toolUseId);
      if (pendingTask) {
        this.state.pendingTaskCreate.delete(toolUseId);
        const taskId = str(obj(structured?.['task'])?.['id']) ?? /#(\w+)/.exec(text)?.[1];
        if (taskId) {
          this.state.plan.set(taskId, {
            id: taskId,
            text: pendingTask.subject,
            activeText: pendingTask.activeForm,
            status: 'pending',
          });
          this.state.planProjection.emitPlan();
        }
        continue;
      }

      const item = this.state.items.get(toolUseId) as ToolItem | undefined;
      if (!item) continue;
      const updated = this.completeTool(item, isError, text, structured, block['content']);
      this.state.upsert(updated);
    }
  }

  completeTool(
    item: ToolItem,
    isError: boolean,
    text: string,
    result: Obj | undefined,
    content: unknown,
  ): ToolItem {
    let status: ItemStatus = isError ? 'failed' : 'done';
    // A denied call still gets an error tool_result; an interrupt produces the same rejection text.
    if (item.status === 'declined') status = 'declined';
    else if (isError && text.startsWith("The user doesn't want to proceed with this tool use"))
      status = 'interrupted';
    const next = { ...item, status, endedAt: this.state.ctx.now() } as ToolItem;
    switch (next.kind) {
      case 'command': {
        const stdout = str(result?.['stdout']);
        const stderr = str(result?.['stderr']);
        next.output =
          stdout !== undefined || stderr !== undefined
            ? [stdout, stderr].filter(Boolean).join('\n')
            : text;
        const exit = /Exit code (\d+)/.exec(text);
        if (exit?.[1]) next.exitCode = Number(exit[1]);
        else if (!isError) next.exitCode = 0;
        if (bool(result?.['interrupted'])) next.status = 'interrupted';
        const bg = str(result?.['backgroundTaskId']);
        if (bg) {
          next.status = 'running';
          next.background = { taskId: bg, state: 'running' };
          this.state.backgroundItems.set(bg, next.id);
        }
        if (bool(result?.['isImage'])) {
          const image = imageBlock(content);
          if (image) next.image = this.state.ctx.attachImage(image);
        }
        break;
      }
      case 'file_change': {
        // Copy before filling in: the running item was already emitted with this array.
        next.files = next.files.map((f) => ({ ...f }));
        const file = next.files[0];
        if (!file) break;
        const git = obj(result?.['gitDiff']);
        const patch = str(git?.['patch']) ?? patchFromStructured(result?.['structuredPatch']);
        if (patch) file.diff = patch;
        file.added = num(git?.['additions']) ?? (patch ? countDiff(patch).added : undefined);
        file.removed = num(git?.['deletions']) ?? (patch ? countDiff(patch).removed : undefined);
        if (str(result?.['type']) === 'create') {
          file.change = 'add';
          const content = str(result?.['content']);
          if (!patch && content !== undefined) {
            file.added = content.split('\n').filter(Boolean).length;
            file.removed = 0;
          }
        }
        break;
      }
      case 'explore': {
        const file = obj(result?.['file']);
        if (str(result?.['type']) === 'image' && file) {
          const dims = obj(file['dimensions']);
          next.image = this.state.ctx.attachImage({
            base64: str(file['base64']) ?? '',
            mime: str(file['type']) ?? 'image/png',
            width: num(dims?.['displayWidth']) ?? num(dims?.['originalWidth']),
            height: num(dims?.['displayHeight']) ?? num(dims?.['originalHeight']),
            path: next.target,
          });
        }
        break;
      }
      case 'task': {
        const summary = arr(result?.['content'])
          .map((c) => str(obj(c)?.['text']))
          .filter(Boolean)
          .join('\n');
        next.summary = summary || text;
        next.actions = num(result?.['totalToolUseCount']) ?? next.actions;
        break;
      }
      case 'tool': {
        next.output = text;
        const images = arr(content)
          .map((c) => imageBlock([c]))
          .filter((i): i is NonNullable<typeof i> => i !== undefined)
          .map((i) => this.state.ctx.attachImage(i));
        if (images.length) next.images = images;
        break;
      }
      default:
        break;
    }
    return next;
  }
}
