import type { ChatSettings } from '../shared/ipc';
import { LiveChat } from './chat-model';

export function saved(settings: Omit<ChatSettings, 'agent'>): Omit<ChatSettings, 'agent'> {
  return {
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(settings.permissionMode === 'full' ? { permissionMode: 'full' as const } : {}),
  };
}

export function lastOf(settings: ChatSettings): ChatSettings {
  const { permissionMode: _mode, ...rest } = settings;
  return rest;
}

export function settingsKey(chatId: string): string {
  return `chat.${chatId}.agent`;
}

export function notesKey(chatId: string): string {
  return `chat.${chatId}.notes`;
}

export function lastKey(projectId: string): string {
  return `chats.${projectId}.last`;
}

export function currentTurn(live: LiveChat): string {
  return live.timeline.state.turns.at(-1)?.id ?? '';
}

/** Chat title: the first line of the first message that is not a file reference. */
export function titleOf(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const line = lines.find((l) => !l.startsWith('@')) ?? lines[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}
