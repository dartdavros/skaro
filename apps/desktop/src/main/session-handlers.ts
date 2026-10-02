import type { Handlers } from './ipc';
import type { Services } from './app-services';

export function sessionHandlers({
  runs,
  board,
  docs,
  plan,
  chats,
}: Services): Pick<
  Handlers,
  | 'tasks.list'
  | 'tasks.slots'
  | 'tasks.run'
  | 'tasks.archive'
  | 'tasks.delete'
  | 'tasks.move'
  | 'tasks.unblock'
  | 'tasks.cancel'
  | 'tasks.merge'
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
  | 'plan.delete'
  | 'plan.reorder'
  | 'plan.placeTask'
  | 'task.open'
  | 'task.send'
  | 'task.respond'
  | 'task.interrupt'
  | 'task.stopBackground'
  | 'task.setSettings'
  | 'task.merge'
  | 'task.revertMerge'
  | 'task.toggleCriterion'
  | 'chats.list'
  | 'chats.defaults'
  | 'chat.open'
  | 'chat.create'
  | 'chat.send'
  | 'chat.respond'
  | 'chat.interrupt'
  | 'chat.setSettings'
  | 'chat.archive'
  | 'chat.proposal'
> {
  return {
    'tasks.list': (projectId) => runs.list(projectId),
    'tasks.slots': () => runs.slots(),
    'tasks.run': (projectId, ids, message, assignment) =>
      runs.launch(projectId, ids, message, assignment),
    'tasks.archive': (projectId, ids, archived) => board.archive(projectId, ids, archived),
    'tasks.delete': (projectId, ids) => board.delete(projectId, ids),
    'tasks.move': (projectId, ids, milestone) => board.move(projectId, ids, milestone),
    'tasks.unblock': (projectId, ids) => board.unblock(projectId, ids),
    'tasks.cancel': (projectId, id) => runs.cancel(projectId, id),
    'tasks.merge': (projectId, id) => runs.mergeFromBoard(projectId, id),
    'tasks.assign': async (projectId, ids, assignment) => {
      for (const id of ids) await runs.assign(projectId, id, assignment);
    },
    'docs.list': (projectId) => docs.list(projectId),
    'docs.read': (projectId, path) => docs.read(projectId, path),
    'docs.write': (projectId, path, text) => docs.write(projectId, path, text),
    'docs.create': (projectId, name) => docs.create(projectId, name),
    'docs.createSpec': (projectId, title) => docs.createSpec(projectId, title),
    'docs.setAdrStatus': (projectId, id, status) => docs.setAdrStatus(projectId, id, status),
    'docs.setSpecStatus': (projectId, id, status) => docs.setSpecStatus(projectId, id, status),
    'docs.reveal': (projectId, path) => docs.reveal(projectId, path),
    'plan.milestones': (projectId) => plan.milestones(projectId),
    'plan.delete': (projectId, id) => plan.delete(projectId, id),
    'plan.reorder': (projectId, ids) => plan.reorder(projectId, ids),
    'plan.placeTask': (projectId, taskId, milestoneId, index) =>
      plan.placeTask(projectId, taskId, milestoneId, index),
    'task.open': (projectId, taskId) => runs.open(projectId, taskId),
    'task.send': (projectId, taskId, input) => runs.send(projectId, taskId, input),
    'task.respond': (projectId, taskId, id, answer) => runs.respond(projectId, taskId, id, answer),
    'task.interrupt': (projectId, taskId) => runs.interrupt(projectId, taskId),
    'task.stopBackground': (projectId, taskId, id) => runs.stopBackground(projectId, taskId, id),
    'task.setSettings': (projectId, taskId, settings) =>
      runs.setSettings(projectId, taskId, settings),
    'task.merge': (projectId, taskId, id, action) => runs.merge(projectId, taskId, id, action),
    'task.revertMerge': (projectId, taskId, commit) => runs.revertMerge(projectId, taskId, commit),
    'task.toggleCriterion': (projectId, taskId, index) =>
      runs.toggleCriterion(projectId, taskId, index),
    'chats.list': (projectId) => chats.list(projectId),
    'chats.defaults': (projectId) => chats.defaults(projectId),
    'chat.open': (projectId, chatId) => chats.open(projectId, chatId),
    'chat.create': (projectId, settings, input) => chats.create(projectId, settings, input),
    'chat.send': (projectId, chatId, input) => chats.send(projectId, chatId, input),
    'chat.respond': (projectId, chatId, id, answer) => chats.respond(projectId, chatId, id, answer),
    'chat.interrupt': (projectId, chatId) => chats.interrupt(projectId, chatId),
    'chat.setSettings': (projectId, chatId, settings) =>
      chats.setSettings(projectId, chatId, settings),
    'chat.archive': (projectId, chatId, archived) => chats.archive(projectId, chatId, archived),
    'chat.proposal': (projectId, chatId, itemId, action) =>
      chats.proposal(projectId, chatId, itemId, action),
  };
}
