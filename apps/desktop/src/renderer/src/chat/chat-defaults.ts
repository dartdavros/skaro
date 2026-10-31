import { defaultAgent } from '@skaro/agents/catalog';
import type { ChatSettings } from '../../../shared/ipc';

/** Preserve the existing default when native settings cannot be read. */
export async function chatDefaults(projectId: string): Promise<ChatSettings> {
  try {
    return await window.skaro.invoke('chats.defaults', projectId);
  } catch {
    return { agent: defaultAgent() };
  }
}
