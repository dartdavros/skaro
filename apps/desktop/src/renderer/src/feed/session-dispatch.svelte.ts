import type { InteractionAnswer, TimelineState } from '@skaro/timeline';
import type { TaskSession } from '../task/session.svelte';
import type { ChatSession } from '../chat/session.svelte';
import { dispatchFeedback } from './dispatch-feedback';

type Session =
  | Pick<TaskSession, 'projectId' | 'taskId' | 'reload'>
  | Pick<ChatSession, 'projectId' | 'chatId' | 'reload'>;
type Guard = (action: () => Promise<unknown>) => Promise<void>;

/** Keep response feedback until an authoritative snapshot acknowledges its next state. */
export class SessionDispatch {
  private answering = $state<string[]>([]);
  private readonly session: Session | undefined;
  private readonly guard: Guard;
  constructor(session: Session | undefined, guard: Guard) {
    this.session = session;
    this.guard = guard;
  }

  timeline(base: TimelineState | undefined, pending = false): TimelineState | undefined {
    return dispatchFeedback(base, pending, this.answering);
  }

  respond = async (id: string, answer: InteractionAnswer): Promise<void> => {
    const session = this.session;
    if (!session) return;
    this.answering = [...this.answering, id];
    try {
      await this.guard(async () => {
        const task = 'taskId' in session;
        await window.skaro.invoke(
          task ? 'task.respond' : 'chat.respond',
          session.projectId,
          task ? session.taskId : session.chatId,
          id,
          answer,
        );
        await session.reload();
      });
    } finally {
      this.answering = this.answering.filter((value) => value !== id);
    }
  };
}
