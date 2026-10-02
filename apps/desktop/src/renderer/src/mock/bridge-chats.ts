import type { ChatSummary } from '../../../shared/ipc';
import type { PreviewHandlers } from './bridge-contract';
import { chats, chatSeqs, chatTimeline, emit } from './bridge-state';

export const chatsHandlers = {
  'chats.list': () => chats.map((c) => ({ ...c })),
  'chats.defaults': () => ({ agent: 'claude-code', model: 'claude-opus-5' }),
  'chat.open': (projectId, chatId) => {
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) throw new Error('The chat is not found');
    return {
      projectId,
      chat,
      settings: { agent: chat.agent, model: 'claude-opus-5', effort: 'high' },
      timeline: chatTimeline(chatId),
      seq: chatSeqs.get(chatId) ?? 1,
    };
  },
  'chat.create': (projectId, settings, input) => {
    const chat: ChatSummary = {
      id: `c${chats.length + 1}`,
      title: input.text.split('\n')[0]!.slice(0, 60),
      agent: settings.agent,
      archived: false,
      live: false,
      updatedAt: Date.now(),
    };
    chats.unshift(chat);
    emit('chats.changed', { projectId });
    return chat;
  },
  'chat.send': () => undefined,
  'chat.respond': () => undefined,
  'chat.interrupt': () => undefined,
  'chat.setSettings': () => undefined,
  'chat.archive': (projectId, chatId, archived) => {
    const chat = chats.find((c) => c.id === chatId);
    if (chat) chat.archived = archived;
    emit('chats.changed', { projectId, chatId });
  },
  'chat.proposal': (projectId, chatId, itemId, action) => {
    const timeline = chatTimeline(chatId);
    timeline.items = timeline.items.map((item) => {
      if (item.id !== itemId || item.kind !== 'proposal') return item;
      if (action.action === 'reject') return { ...item, state: 'rejected' };
      if (action.action === 'revert') return { ...item, state: 'reverted' };
      const p = item.proposal;
      const tasks =
        p.type === 'plan'
          ? p.tasks
              .filter((t) => !action.tasks || action.tasks.includes(t.ref))
              .map((t, i) => ({ id: `T-01${i + 3}`, title: t.title, ref: t.ref }))
          : undefined;
      return {
        ...item,
        state: 'applied',
        result: {
          ...(p.type === 'plan' && p.milestone?.isNew
            ? { milestone: { id: p.milestone.id, title: p.milestone.title } }
            : {}),
          ...(tasks ? { tasks } : {}),
          ...(p.type === 'adr' ? { adr: { id: p.id, title: action.adr?.title ?? p.title } } : {}),
          ...(p.type === 'import'
            ? {
                applied: action.import?.length ?? p.total,
                imported: [
                  { kind: 'brief' as const, title: 'Бриф', update: false },
                  { kind: 'architecture' as const, title: 'Архитектура', update: true },
                  {
                    kind: 'adr' as const,
                    code: 'ADR-0008',
                    title: 'Выбор эквайера',
                    update: false,
                  },
                  { kind: 'adr' as const, code: 'ADR-0009', title: 'Очередь задач', update: false },
                  {
                    kind: 'spec' as const,
                    code: 'SPEC-0004',
                    title: 'Возвраты по картам',
                    update: false,
                  },
                  { kind: 'plan' as const, code: 'M04', title: 'Возвраты', update: false },
                ],
              }
            : {}),
        },
      };
    });
    chatSeqs.set(chatId, (chatSeqs.get(chatId) ?? 1) + 1);
    emit('chats.changed', { projectId, chatId });
  },
} satisfies Pick<
  PreviewHandlers,
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
>;
