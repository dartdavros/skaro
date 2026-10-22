import type { Handlers } from './ipc';
import type { Services } from './app-services';
import { historyReads } from './history-read-service';
import { clipboard } from 'electron';

export function sessionHandlers({
  runs,
  board,
  docs,
  plan,
  chats,
  c4,
}: Services): Pick<
  Handlers,
  | 'history.changes'
  | 'history.page'
  | 'history.find'
  | 'history.copy'
  | 'c4.files'
  | 'c4.file'
  | 'c4.content'
  | 'c4.decide'
  | keyof import('../shared/c4-review').C4ReviewMethods
  | keyof import('../shared/task-catalog').TaskCatalogMethods
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
  | 'stages.list'
  | 'stages.run'
  | 'stages.stop'
  | 'docs.list'
  | 'docs.catalog'
  | 'docs.page'
  | 'docs.lookup'
  | 'docs.read'
  | 'docs.document'
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
  | 'task.clear'
  | 'task.stopBackground'
  | 'task.setSettings'
  | 'task.merge'
  | 'task.revertMerge'
  | 'task.toggleCriterion'
  | 'chats.list'
  | keyof import('../shared/chat-catalog').ChatCatalogMethods
  | 'chats.defaults'
  | 'chat.open'
  | 'chat.create'
  | 'chat.send'
  | 'chat.respond'
  | 'chat.interrupt'
  | 'chat.setSettings'
  | 'chat.archive'
  | 'chat.clear'
  | 'chat.proposal'
> {
  return {
    'history.changes': (source, start) => historyReads().changes(source, start),
    'history.page': (source, start, limit) => historyReads().page(source, start, limit),
    'history.find': (source, id) => historyReads().find(source, id),
    'history.copy': async (source, pending) => {
      await clipboard.writeText(await historyReads().copy(source, pending));
    },
    'c4.files': (projectId, itemId) => c4.files(projectId, itemId),
    'c4.file': (projectId, itemId, path, side) => c4.file(projectId, itemId, path, side),
    'c4.content': (projectId, itemId, side) => c4.content(projectId, itemId, side),
    'c4.decide': (projectId, itemId, action, fingerprint) =>
      c4.decide(projectId, itemId, action, fingerprint),
    'c4.review': (projectId, itemId) => c4.reviewPackage(projectId, itemId),
    'c4.reviewDetail': (projectId, itemId, key) => c4.reviewDetail(projectId, itemId, key),
    'c4.reviewModel': (projectId, itemId, side) => c4.reviewModel(projectId, itemId, side),
    'tasks.list': (projectId) => runs.list(projectId),
    'plan.catalog': (project) => runs.catalog.plan(project),
    'plan.relations': (project, id) => runs.catalog.relations(project, id),
    'plan.milestone': (project, id) => runs.catalog.milestone(project, id),
    'plan.archiveGroup': async (project, milestone, archived) => {
      await board.archive(
        project,
        await runs.catalog.groupIds(project, milestone, !archived),
        archived,
      );
    },
    'tasks.catalog': (projectId) => runs.catalog.sync(projectId),
    'tasks.query': (projectId, query) => runs.catalog.query(projectId, query),
    'tasks.page': (source, start) => runs.catalog.page(source, start),
    'tasks.find': (source, id) => runs.catalog.find(source, id),
    'tasks.select': (source) => runs.catalog.select(source),
    'tasks.selected': (projectId, ids) => runs.catalog.selected(projectId, ids),
    'tasks.reorder': (source, id, column, index) => runs.catalog.reorder(source, id, column, index),
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
    'stages.list': (projectId) => runs.stages(projectId),
    'stages.run': (projectId, stageId, message) => runs.runStage(projectId, stageId, message),
    'stages.stop': (projectId, stageId) => runs.stopStage(projectId, stageId),
    'docs.list': (projectId) => docs.list(projectId),
    'docs.catalog': (projectId) => docs.catalog(projectId),
    'docs.page': (projectId, kind, start) => docs.page(projectId, kind, start),
    'docs.lookup': (projectId, key) => docs.lookup(projectId, key),
    'docs.read': (projectId, path) => docs.read(projectId, path),
    'docs.document': (projectId, path) => docs.document(projectId, path),
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
    'task.open': async (projectId, taskId, options) => {
      await c4.restore({ kind: 'task', projectId, taskId });
      return runs.open(projectId, taskId, options);
    },
    'task.send': (projectId, taskId, input) => runs.send(projectId, taskId, input),
    'task.respond': (projectId, taskId, id, answer) => runs.respond(projectId, taskId, id, answer),
    'task.interrupt': (projectId, taskId) => runs.interrupt(projectId, taskId),
    'task.clear': (projectId, taskId) => runs.clearChat(projectId, taskId),
    'task.stopBackground': (projectId, taskId, id) => runs.stopBackground(projectId, taskId, id),
    'task.setSettings': (projectId, taskId, settings) =>
      runs.setSettings(projectId, taskId, settings),
    'task.merge': (projectId, taskId, id, action) => runs.merge(projectId, taskId, id, action),
    'task.revertMerge': (projectId, taskId, commit) => runs.revertMerge(projectId, taskId, commit),
    'task.toggleCriterion': (projectId, taskId, index) =>
      runs.toggleCriterion(projectId, taskId, index),
    'chats.list': (projectId) => chats.list(projectId),
    'chats.query': (projectId, archived) => chats.query(projectId, archived),
    'chats.page': (source, start) => chats.page(source, start),
    'chats.find': (source, id) => chats.find(source, id),
    'chats.defaults': (projectId) => chats.defaults(projectId),
    'chat.open': async (projectId, chatId, options) => {
      await c4.restore({ kind: 'project_chat', projectId, chatId });
      return chats.open(projectId, chatId, options);
    },
    'chat.create': (projectId, settings, input) => chats.create(projectId, settings, input),
    'chat.send': (projectId, chatId, input) => chats.send(projectId, chatId, input),
    'chat.respond': (projectId, chatId, id, answer) => chats.respond(projectId, chatId, id, answer),
    'chat.interrupt': (projectId, chatId) => chats.interrupt(projectId, chatId),
    'chat.setSettings': (projectId, chatId, settings) =>
      chats.setSettings(projectId, chatId, settings),
    'chat.archive': (projectId, chatId, archived) => chats.archive(projectId, chatId, archived),
    'chat.clear': (projectId, chatId) => chats.clear(projectId, chatId),
    'chat.proposal': (projectId, chatId, itemId, action) =>
      itemId.startsWith('skaro-c4-') && action.action !== 'revert'
        ? c4.decide(
            projectId,
            itemId,
            action.action,
            action.action === 'apply' ? action.fingerprint : undefined,
          )
        : chats.proposal(projectId, chatId, itemId, action),
  };
}
