import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDb } from './appdb.ts';

let clock = 1000;
let db: AppDb;

beforeEach(() => {
  clock = 1000;
  db = AppDb.open(':memory:', () => clock++);
});

afterEach(() => db.close());

describe('AppDb', () => {
  it('migrates a new database', () => {
    expect(db.schemaVersion).toBe(1);
  });

  it('keeps projects, most recently opened first', () => {
    const a = db.addProject({ name: 'A', path: '/a' });
    const b = db.addProject({ name: 'B', path: '/b' });
    db.touchProject(a.id);
    expect(db.listProjects().map((p) => p.name)).toEqual(['A', 'B']);
    expect(db.findProjectByPath('/b')?.id).toBe(b.id);
    expect(() => db.addProject({ name: 'dup', path: '/a' })).toThrow();
  });

  it('restores open tabs and cascades project removal', () => {
    const a = db.addProject({ name: 'A', path: '/a' });
    const b = db.addProject({ name: 'B', path: '/b' });
    db.setOpenTabs([b.id, a.id], a.id);
    expect(db.getOpenTabs()).toEqual([
      { projectId: b.id, active: false },
      { projectId: a.id, active: true },
    ]);
    db.setTaskRuntime(a.id, 'T-001', 'running');
    db.removeProject(a.id);
    expect(db.getOpenTabs()).toEqual([{ projectId: b.id, active: false }]);
    expect(db.getTaskRuntime(a.id).size).toBe(0);
  });

  it('stores settings as JSON', () => {
    expect(db.getSetting('runs.slots', 3)).toBe(3);
    db.setSetting('runs.slots', 5);
    db.setSetting('ui', { theme: 'dark' });
    expect(db.getSetting('runs.slots', 3)).toBe(5);
    expect(db.getSetting('ui', {})).toEqual({ theme: 'dark' });
  });

  it('tracks runtime task state and resets it after a restart', () => {
    const p = db.addProject({ name: 'P', path: '/p' });
    db.setTaskRuntime(p.id, 'T-001', 'running', 'run-1');
    db.setTaskRuntime(p.id, 'T-002', 'waiting', 'run-2');
    db.setTaskRuntime(p.id, 'T-003', 'queued');
    db.setTaskRuntime(p.id, 'T-004', 'running');
    db.setTaskRuntime(p.id, 'T-004', 'idle');
    expect([...db.getTaskRuntime(p.id).keys()].sort()).toEqual(['T-001', 'T-002', 'T-003']);

    const reset = db.resetStaleRuntime();
    expect(reset.map((r) => r.taskId).sort()).toEqual(['T-001', 'T-003']);
    expect([...db.getTaskRuntime(p.id)]).toEqual([['T-002', { state: 'waiting', runId: 'run-2' }]]);
  });

  it('indexes runs per task', () => {
    const p = db.addProject({ name: 'P', path: '/p' });
    const first = db.createRun({
      projectId: p.id,
      taskId: 'T-001',
      agent: 'claude-code',
      logPath: 'a.jsonl',
      adapterVersion: '0.1.0',
    });
    const second = db.createRun({
      projectId: p.id,
      taskId: 'T-001',
      agent: 'codex',
      model: 'gpt',
      logPath: 'b.jsonl',
      adapterVersion: '0.1.0',
    });
    db.createRun({
      projectId: p.id,
      taskId: 'T-002',
      agent: 'codex',
      logPath: 'c.jsonl',
      adapterVersion: '0.1.0',
    });
    db.setRunSession(first.id, 'session-1');
    db.finishRun(first.id, 'done');
    expect(db.listRuns(p.id, 'T-001').map((r) => r.id)).toEqual([second.id, first.id]);
    expect(db.getRun(first.id)).toMatchObject({ outcome: 'done', nativeSessionId: 'session-1' });
    expect(db.getRun(second.id)?.endedAt).toBeUndefined();
    expect(db.listRuns(p.id)).toHaveLength(3);
  });

  it('separates project and task chats and archives them', () => {
    const p = db.addProject({ name: 'P', path: '/p' });
    const projectChat = db.createChat({
      projectId: p.id,
      agent: 'claude-code',
      title: 'Plan',
      logPath: 'x',
    });
    const taskChat = db.createChat({
      projectId: p.id,
      taskId: 'T-001',
      agent: 'codex',
      title: 'T',
      logPath: 'y',
    });
    expect(db.listChats(p.id).map((c) => c.id)).toEqual([projectChat.id]);
    expect(db.listChats(p.id, { taskId: 'T-001' }).map((c) => c.id)).toEqual([taskChat.id]);
    db.updateChat(projectChat.id, { archived: true, nativeSessionId: 's' });
    expect(db.listChats(p.id)).toEqual([]);
    expect(db.listChats(p.id, { archived: true })[0]).toMatchObject({
      nativeSessionId: 's',
      agent: 'claude-code',
    });
  });

  it('records merges and reverts', () => {
    const p = db.addProject({ name: 'P', path: '/p' });
    const m = db.recordMerge({
      projectId: p.id,
      taskId: 'T-001',
      branch: 'skaro/T-001-a',
      commit: 'abc',
      strategy: 'squash',
    });
    db.markMergeReverted(m.id, 'def');
    expect(db.listMerges(p.id, 'T-001')).toEqual([{ ...m, revertCommit: 'def' }]);
  });

  it('keeps open interactions until closed', () => {
    const p = db.addProject({ name: 'P', path: '/p' });
    db.openInteraction({
      id: 'i1',
      projectId: p.id,
      runId: 'r1',
      kind: 'approval',
      payload: { command: 'npm i' },
    });
    db.openInteraction({ id: 'i2', projectId: p.id, chatId: 'c1', kind: 'question', payload: {} });
    db.closeInteraction('i2', 'answered');
    expect(db.listOpenInteractions(p.id)).toEqual([
      {
        id: 'i1',
        projectId: p.id,
        runId: 'r1',
        chatId: undefined,
        kind: 'approval',
        payload: { command: 'npm i' },
        openedAt: expect.any(Number),
      },
    ]);
  });

  it('persists to a file and does not re-run migrations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skaro-db-'));
    try {
      const path = join(dir, 'skaro.db');
      const first = AppDb.open(path);
      first.addProject({ name: 'P', path: '/p' });
      first.close();
      const second = AppDb.open(path);
      expect(second.schemaVersion).toBe(1);
      expect(second.listProjects().map((p) => p.name)).toEqual(['P']);
      second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
