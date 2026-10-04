import type { SQLInputValue } from 'node:sqlite';
import type { ProjectRecord, RunRecord, ChatRecord, RunOutcome } from './model.ts';

export type Row = Record<string, SQLInputValue>;

export function opt(value: SQLInputValue | undefined): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

export function toProject(r: Row): ProjectRecord {
  return {
    id: String(r['id']),
    name: String(r['name']),
    path: String(r['path']),
    createdAt: Number(r['created_at']),
    lastOpenedAt: r['last_opened_at'] === null ? undefined : Number(r['last_opened_at']),
    ...(typeof r['logo'] === 'string' ? { logo: r['logo'] } : {}),
  };
}

export function toRun(r: Row): RunRecord {
  return {
    id: String(r['id']),
    projectId: String(r['project_id']),
    taskId: String(r['task_id']),
    agent: String(r['agent']),
    model: opt(r['model']),
    worktree: opt(r['worktree']),
    branch: opt(r['branch']),
    logPath: String(r['log_path']),
    adapterVersion: String(r['adapter_version']),
    nativeSessionId: opt(r['native_session_id']),
    startedAt: Number(r['started_at']),
    endedAt: r['ended_at'] === null ? undefined : Number(r['ended_at']),
    outcome: opt(r['outcome']) as RunOutcome | undefined,
  };
}

export function toChat(r: Row): ChatRecord {
  return {
    id: String(r['id']),
    projectId: String(r['project_id']),
    taskId: opt(r['task_id']),
    agent: String(r['agent']),
    title: String(r['title']),
    nativeSessionId: opt(r['native_session_id']),
    logPath: String(r['log_path']),
    archived: r['archived'] === 1,
    createdAt: Number(r['created_at']),
    updatedAt: Number(r['updated_at']),
  };
}
