import {
  arr,
  bool,
  num,
  obj,
  str,
  type AgentErrorCategory,
  type FileChange,
  type Item,
  type ItemBody,
  type Obj,
  type Question,
} from '@skaro/timeline';

export const AGENT = 'claude';

export const PLAN_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite']);

export const SILENT_SYSTEM = new Set([
  'hook_started',
  'hook_progress',
  'hook_response',
  'plugin_install',
  'files_persisted',
  'memory_recall',
  'commands_changed',
  'control_request_progress',
  'elicitation_complete',
  'thinking_tokens',
  'worker_shutting_down',
  'mirror_error',
  'notification',
  // Human-readable "doing X" / turn summaries; candidates for the live line and board status.
  'task_summary',
  'post_turn_summary',
]);

export const SILENT_TYPES = new Set([
  'keep_alive',
  'prompt_suggestion',
  'tool_use_summary',
  'tool_progress',
  'control_cancel_request',
  'auth_status',
  'conversation_reset',
]);

export type ToolItem = Item & { toolName: string };

export function toolBody(name: string, input: Obj): ItemBody {
  switch (name) {
    case 'Read':
      return {
        kind: 'explore',
        op: 'read',
        target: str(input['file_path']) ?? '',
        detail: rangeOf(input),
      };
    case 'Glob':
      return {
        kind: 'explore',
        op: 'list',
        target: str(input['pattern']) ?? '',
        detail: str(input['path']),
      };
    case 'Grep':
      return {
        kind: 'explore',
        op: 'search',
        target: str(input['pattern']) ?? '',
        detail: str(input['path']),
      };
    case 'WebFetch':
      return { kind: 'explore', op: 'fetch', target: str(input['url']) ?? '' };
    case 'WebSearch':
      return { kind: 'explore', op: 'web', target: str(input['query']) ?? '' };
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': {
      const path = str(input['file_path']) ?? str(input['notebook_path']) ?? '';
      const file: FileChange = { path, change: 'update' };
      return { kind: 'file_change', files: [file] };
    }
    case 'Bash':
    case 'PowerShell':
      return {
        kind: 'command',
        command: str(input['command']) ?? '',
        description: str(input['description']),
        output: '',
        outputLive: false,
      };
    case 'Agent':
    case 'Task':
    case 'Workflow':
      return {
        kind: 'task',
        title: str(input['description']) ?? str(input['name']) ?? name,
        agentType: str(input['subagent_type']),
      };
    default: {
      const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
      return {
        kind: 'tool',
        name: mcp?.[2] ?? name,
        server: mcp?.[1],
        input: JSON.stringify(input),
      };
    }
  }
}

export function rangeOf(input: Obj): string | undefined {
  const offset = num(input['offset']);
  const limit = num(input['limit']);
  if (offset === undefined && limit === undefined) return undefined;
  const from = offset ?? 1;
  return limit ? `${from}-${from + limit - 1}` : `${from}-`;
}

export function questionsOf(input: Obj): Question[] {
  return arr(input['questions']).map((q, index) => {
    const question = obj(q) ?? {};
    return {
      id: str(question['question']) ?? String(index),
      header: str(question['header']) ?? '',
      text: str(question['question']) ?? '',
      multi: bool(question['multiSelect']) ?? false,
      allowFreeText: true,
      options: arr(question['options']).map((o) => {
        const option = obj(o) ?? {};
        return {
          label: str(option['label']) ?? '',
          description: str(option['description']),
          preview: str(option['preview']),
        };
      }),
    };
  });
}

export function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  return arr(content)
    .map((c) => (obj(c)?.['type'] === 'text' ? str(obj(c)?.['text']) : undefined))
    .filter(Boolean)
    .join('\n');
}

export function imageBlock(content: unknown): { base64: string; mime: string } | undefined {
  for (const c of arr(content)) {
    const block = obj(c);
    if (block?.['type'] !== 'image') continue;
    const source = obj(block['source']);
    const base64 = str(source?.['data']) ?? str(block['data']);
    if (base64)
      return { base64, mime: str(source?.['media_type']) ?? str(block['mimeType']) ?? 'image/png' };
  }
  return undefined;
}

export function patchFromStructured(patch: unknown): string | undefined {
  const hunks = arr(patch)
    .map(obj)
    .filter((h): h is Obj => h !== undefined);
  if (!hunks.length) return undefined;
  return hunks
    .map((h) => {
      const header = `@@ -${num(h['oldStart'])},${num(h['oldLines'])} +${num(h['newStart'])},${num(h['newLines'])} @@`;
      return [header, ...arr(h['lines']).filter((l): l is string => typeof l === 'string')].join(
        '\n',
      );
    })
    .join('\n');
}

export function textOf(message: Obj | undefined): string {
  return arr(message?.['content'])
    .map((b) => str(obj(b)?.['text']))
    .filter(Boolean)
    .join('\n');
}

export function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).host : undefined;
  } catch {
    return undefined;
  }
}

export function errorCategory(error: string): AgentErrorCategory {
  switch (error) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'account_on_hold':
    case 'verification_required':
    case 'cloud_credential_error':
      return 'auth';
    case 'rate_limit':
    case 'billing_error':
      return 'limit';
    case 'overloaded':
    case 'server_error':
      return 'overloaded';
    default:
      return 'other';
  }
}

export function categoryFromText(text: string, status: number | undefined): AgentErrorCategory {
  if (status === 401 || status === 403 || /log ?in|auth/i.test(text)) return 'auth';
  if (status === 429 || /rate limit|usage limit/i.test(text)) return 'limit';
  if (status === 529 || status === 503 || /overloaded/i.test(text)) return 'overloaded';
  if (/prompt is too long|context/i.test(text)) return 'context_overflow';
  if (/network|ECONN|ETIMEDOUT|fetch failed/i.test(text)) return 'network';
  return 'other';
}
