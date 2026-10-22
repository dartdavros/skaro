import type { AppDb } from '@skaro/core';
import type { ChatSessions } from './chats';
import type { TaskRuns } from './tasks';

export interface AgentActivity {
  working: number;
  waiting: number;
  busy: boolean;
}

/** Read bounded runtime metadata; never load project files or conversation histories for the tray. */
export function agentActivity(db: AppDb, runs: TaskRuns, chats: ChatSessions): AgentActivity {
  const tasks = db.taskRuntimeCounts();
  const chat = chats.activity();
  const working = tasks.running + chat.working + runs.publicationAgents();
  const waiting = tasks.waiting + chat.waiting;
  const slots = runs.slots();
  return {
    working,
    waiting,
    busy: working + waiting + tasks.queued > 0 || slots.free < slots.total,
  };
}
