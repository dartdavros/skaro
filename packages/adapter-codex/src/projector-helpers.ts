import {
  arr,
  countDiff,
  obj,
  str,
  type AgentErrorCategory,
  type FileChange,
  type ItemBody,
  type ItemStatus,
  type Obj,
} from '@skaro/timeline';

export const AGENT = 'codex';

/** Notifications that only go to the raw log. */
export const SILENT = new Set([
  'thread/started',
  'thread/name/updated',
  'thread/settings/updated',
  'thread/queue/changed',
  'thread/goal/updated',
  'thread/goal/cleared',
  'turn/diff/updated',
  // Duplicates the contextCompaction item.
  'thread/compacted',
  'item/reasoning/summaryPartAdded',
  'item/mcpToolCall/progress',
  'item/fileChange/outputDelta',
  'hook/started',
  'hook/completed',
  'rawResponseItem/completed',
  'rawResponse/completed',
  'skills/changed',
  'account/updated',
  'app/list/updated',
  'fs/changed',
  'turn/moderationMetadata',
  'model/verification',
  'model/safetyBuffering/updated',
  'remoteControl/status/changed',
  'thread/environment/connected',
  'thread/environment/disconnected',
  'thread/attachment/updated',
  'thread/project/updated',
  'project/changed',
  'modelProvider/authRecoveryStarted',
  'modelProvider/authRecoveryCompleted',
]);

export function statusOf(status: string | undefined): ItemStatus {
  switch (status) {
    case 'inProgress':
      return 'running';
    case 'failed':
      return 'failed';
    case 'declined':
      return 'declined';
    default:
      return 'done';
  }
}

export function filesOf(changes: unknown): FileChange[] {
  return arr(changes).map((c) => {
    const change = obj(c) ?? {};
    const kind = obj(change['kind']);
    const kindType = str(kind?.['type']) ?? str(change['kind']);
    const movePath = str(kind?.['move_path']);
    const diff = str(change['diff']);
    // For a new file the diff is the file content itself.
    const counts =
      diff === undefined
        ? undefined
        : kindType === 'add'
          ? { added: diff.split('\n').filter(Boolean).length, removed: 0 }
          : countDiff(diff);
    return {
      path: str(change['path']) ?? '',
      change:
        kindType === 'add'
          ? 'add'
          : kindType === 'delete'
            ? 'delete'
            : movePath
              ? 'move'
              : 'update',
      movePath,
      diff,
      added: counts?.added,
      removed: counts?.removed,
    };
  });
}

export function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext === 'jpg' || ext === 'jpeg'
    ? 'image/jpeg'
    : ext === 'gif'
      ? 'image/gif'
      : ext === 'webp'
        ? 'image/webp'
        : 'image/png';
}

export function errorInfo(error: Obj | undefined): string {
  const info = error?.['codexErrorInfo'];
  if (typeof info === 'string') return info;
  return Object.keys(obj(info) ?? {})[0] ?? '';
}

export function errorCategory(error: Obj | undefined): AgentErrorCategory {
  switch (errorInfo(error)) {
    case 'unauthorized':
      return 'auth';
    case 'usageLimitExceeded':
    case 'rateLimitExceeded':
    case 'sessionBudgetExceeded':
      return 'limit';
    case 'serverOverloaded':
    case 'internalServerError':
      return 'overloaded';
    case 'contextWindowExceeded':
      return 'context_overflow';
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
      return 'network';
    case 'cyberPolicy':
    case 'misalignmentPolicyViolation':
      return 'refusal';
    default:
      return /log ?in|auth|401/i.test(str(error?.['message']) ?? '') ? 'auth' : 'other';
  }
}

export function noticeCode(error: Obj | undefined): Extract<ItemBody, { kind: 'notice' }>['code'] {
  switch (errorCategory(error)) {
    case 'auth':
      return 'auth';
    case 'limit':
      return 'rate_limit';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

export const SHELL_WRAPPER =
  /^\s*"?[^"\s]*?(?:pwsh|powershell|bash|zsh|sh|cmd)(?:\.exe)?"?\s+(?:-NoProfile\s+)?(?:-Command|-lc|-c|\/c)\s+([\s\S]+)$/i;

/**
 * The command as the agent wrote it. Codex runs it through a shell (`pwsh -Command "…"`,
 * `bash -lc '…'`); the single parsed action or the unwrapped argument is what the user reads.
 */
export function displayCommand(command: string, actions: Obj[]): string {
  const inner = actions.map((a) => str(a['command'])).filter((c): c is string => !!c);
  if (inner.length === 1) return inner[0]!;
  const wrapped = SHELL_WRAPPER.exec(command);
  if (!wrapped) return command;
  const arg = wrapped[1]!.trim();
  const quote = arg[0];
  if ((quote === '"' || quote === "'") && arg.length > 1 && arg.endsWith(quote)) {
    return quote === '"' ? arg.slice(1, -1).replace(/\\"/g, '"') : arg.slice(1, -1);
  }
  return arg;
}
