import { demoTimeline } from '../demo-timeline';
import { docs } from './docs';
import { board, milestones, plan, tasks } from './tasks';
import type { PreviewHandlers } from './bridge-contract';
import { taskSettings, detail, emit, boardChanged } from './bridge-state';

export const tasksHandlers = {
  'tasks.list': () => tasks.map((t) => ({ ...t })),
  'tasks.slots': () => ({ total: 3, free: 1 }),
  'tasks.run': (projectId, ids) => boardChanged(projectId, () => board.run(ids)),
  'tasks.archive': (projectId, ids, archived) =>
    boardChanged(projectId, () => board.archive(ids, archived)),
  'tasks.delete': (projectId, ids) => boardChanged(projectId, () => board.delete(ids)),
  'tasks.move': (projectId, ids, milestone) =>
    boardChanged(projectId, () => board.move(ids, milestone)),
  'tasks.unblock': (projectId, ids) => boardChanged(projectId, () => board.unblock(ids)),
  'tasks.assign': (projectId, ids, a) =>
    boardChanged(projectId, () => board.assign(ids, a.agent, a.model)),
  'docs.list': () => docs.list(),
  'docs.read': (_p, path) => docs.read(path),
  'docs.write': (projectId, path, text) => boardChanged(projectId, () => docs.write(path, text)),
  'docs.create': (projectId, name) => {
    const entry = docs.create(name);
    emit('project.changed', { projectId });
    return entry;
  },
  'docs.createSpec': (projectId, title) => {
    const entry = docs.createSpec(title);
    emit('project.changed', { projectId });
    return entry;
  },
  'docs.setAdrStatus': (projectId, id, status) =>
    boardChanged(projectId, () => docs.setStatus(id, status)),
  'docs.setSpecStatus': (projectId, id, status) =>
    boardChanged(projectId, () => docs.setSpecStatus(id, status)),
  'docs.reveal': () => undefined,
  'plan.milestones': () => milestones.map((m) => ({ ...m })),
  'plan.create': (projectId, input) => {
    const created = plan.create(input);
    emit('project.changed', { projectId });
    return created;
  },
  'plan.update': (projectId, id, input) => boardChanged(projectId, () => plan.update(id, input)),
  'plan.delete': (projectId, id) => boardChanged(projectId, () => plan.delete(id)),
  'plan.reorder': (projectId, ids) => boardChanged(projectId, () => plan.reorder(ids)),
  'plan.placeTask': (projectId, taskId, milestoneId, index) =>
    boardChanged(projectId, () => plan.placeTask(taskId, milestoneId, index)),
  'task.open': (projectId, taskId) => ({
    projectId,
    task: detail(taskId),
    settings: taskSettings,
    ...(taskId === 'T-022'
      ? {}
      : {
          run: {
            id: 'r1',
            agent: 'claude-code',
            startedAt: Date.now() - 300_000,
            worktree: 'C:/work/shop-api',
            branch: 'skaro/T-020-admin-roles',
            live: true,
          },
          timeline: demoTimeline(taskId === 'T-021' ? 'finished' : 'working'),
        }),
    seq: 0,
    queued: false,
    slotsFree: true,
    sandboxHolds: false,
  }),
  'task.send': () => undefined,
  'task.respond': () => undefined,
  'task.interrupt': () => undefined,
  'task.rewind': () => undefined,
  'task.stopBackground': () => undefined,
  'task.setSettings': (_p, _t, next) => void Object.assign(taskSettings, next),
  'task.merge': () => undefined,
  'task.toggleCriterion': () => undefined,
} satisfies Pick<
  PreviewHandlers,
  | 'tasks.list'
  | 'tasks.slots'
  | 'tasks.run'
  | 'tasks.archive'
  | 'tasks.delete'
  | 'tasks.move'
  | 'tasks.unblock'
  | 'tasks.assign'
  | 'docs.list'
  | 'docs.read'
  | 'docs.write'
  | 'docs.create'
  | 'docs.createSpec'
  | 'docs.setAdrStatus'
  | 'docs.setSpecStatus'
  | 'docs.reveal'
  | 'plan.milestones'
  | 'plan.create'
  | 'plan.update'
  | 'plan.delete'
  | 'plan.reorder'
  | 'plan.placeTask'
  | 'task.open'
  | 'task.send'
  | 'task.respond'
  | 'task.interrupt'
  | 'task.rewind'
  | 'task.stopBackground'
  | 'task.setSettings'
  | 'task.merge'
  | 'task.toggleCriterion'
>;
