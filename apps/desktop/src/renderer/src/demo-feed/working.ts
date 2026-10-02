import type { TimelineEvent } from '@skaro/timeline';
import { W, item } from './events';

/** The agent is still working: running and queued actions waiting for permission. */
export function working(): TimelineEvent[] {
  return [
    item({
      id: 'c3',
      kind: 'command',
      command: 'npx tsc --noEmit',
      description: 'Проверяет типы во всём проекте',
      output: '',
      outputLive: false,
      status: 'running',
    }),
    item({
      id: 'c6',
      kind: 'command',
      command: 'npm install @casl/ability@6',
      description: 'Устанавливает библиотеку прав',
      output: '',
      outputLive: false,
      status: 'queued',
    }),
    item({
      id: 'e8',
      kind: 'file_change',
      files: [{ path: `${W}/src/services/refunds.ts`, change: 'update' }],
      status: 'queued',
    }),
    {
      t: 'interaction.opened',
      interaction: {
        kind: 'approval',
        id: 'ap1',
        itemId: 'c6',
        action: {
          type: 'command',
          title: 'npm install',
          command: 'npm install @casl/ability@6',
          reason:
            'Нужна библиотека для матрицы прав — установка пакетов вне режима «Авто в пределах задачи».',
        },
        choices: ['allow_once', 'allow_session', 'deny'],
      },
    },
    {
      t: 'interaction.opened',
      interaction: {
        kind: 'approval',
        id: 'ap2',
        itemId: 'e8',
        action: {
          type: 'file_write',
          title: 'refunds.ts',
          paths: [`${W}/src/services/refunds.ts`],
          reason: 'Добавляю проверку роли для возврата без заказа',
        },
        choices: ['allow_once', 'allow_session', 'deny'],
      },
    },
    { t: 'activity', state: 'preparing_edit', target: `${W}/src/services/orders.ts` },
    { t: 'usage', inputTokens: 90_000, outputTokens: 4000, contextUsedPct: 72 },
  ];
}
