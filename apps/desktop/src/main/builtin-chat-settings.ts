import type { AppDb } from '@skaro/core';
import type { ChatSettings } from '../shared/ipc';
import { parseBuiltinSessionSelection } from './builtin-session-selection';
import type { ChatEngine } from './chat-engine';
import type { LiveChat } from './chat-model';
import { isDeepStrictEqual } from 'node:util';

export type BuiltinChatSettings = Omit<ChatSettings, 'agent' | 'model' | 'permissionMode'> & {
  agent: 'skaro';
  model: string;
  permissionMode: 'ask' | 'full';
};
export type BuiltinChatOptions = Omit<BuiltinChatSettings, 'agent'>;
export const builtinChatSettingsKey = (id: string) => `builtin.chat.${id}.settings`;

export function parseBuiltinChatSettings(value: unknown): BuiltinChatSettings {
  const selected = value as Partial<BuiltinChatSettings> | null;
  if (
    !selected ||
    typeof selected !== 'object' ||
    Object.keys(selected).some(
      (key) => !['agent', 'model', 'effort', 'permissionMode'].includes(key),
    ) ||
    !['ask', 'full'].includes(selected.permissionMode ?? '')
  )
    throw new Error('Builtin chat requires an exact route and explicit chat permissions');
  return { ...parseBuiltinSessionSelection(selected), permissionMode: selected.permissionMode! };
}

export function saveBuiltinChatSettings(
  db: Pick<AppDb, 'setSetting'>,
  id: string,
  settings: BuiltinChatSettings,
) {
  db.setSetting(builtinChatSettingsKey(id), parseBuiltinChatSettings(settings));
}

/** Missing choices fail closed; managed chat preferences are never a permission fallback. */
export function builtinChatSettings(ctx: ChatEngine, live: LiveChat): BuiltinChatSettings {
  const saved = ctx.deps.db.getChat(live.chat.id);
  if (
    ctx.closing ||
    live.stopping ||
    live.stopError ||
    ctx.live.get(live.chat.id) !== live ||
    !saved ||
    saved.projectId !== live.projectId ||
    saved.agent !== 'skaro' ||
    live.chat.agent !== 'skaro' ||
    saved.archived ||
    live.chat.archived ||
    saved.nativeSessionId !== live.chat.nativeSessionId
  )
    throw new Error('Builtin chat settings require the actual current chat');
  return parseBuiltinChatSettings(ctx.deps.db.getSetting(builtinChatSettingsKey(saved.id), null));
}

export function requireBuiltinChatSettings(
  ctx: ChatEngine,
  live: LiveChat,
  expected: BuiltinChatSettings,
) {
  if (!isDeepStrictEqual(builtinChatSettings(ctx, live), expected))
    throw new Error('Builtin chat settings changed during startup');
}
