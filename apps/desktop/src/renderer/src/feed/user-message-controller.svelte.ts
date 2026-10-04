import { useFeed } from './context.svelte';
const IMPORT_HEADS = ['Импортировать документацию', 'Import documentation'];
import type { UserMessageProps } from './user-message-props';
export function createUserMessageController(p: UserMessageProps) {
  const feed = useFeed();
  const queued = $derived(p.row.item.status === 'queued');

  /**
   * The first message of an import chat (AgentChat mockup): "Импортировать документацию" and a
   * line per source in mono ("~/Docs/shop · 42 файла").
   */
  const importLines = $derived.by(() => {
    const [head, ...rest] = p.row.item.text.split('\n');
    if (!head || !IMPORT_HEADS.includes(head) || !rest.length) return undefined;
    return rest.every((l) => / · \d+ /.test(l)) ? { head, sources: rest } : undefined;
  });

  return {
    p,
    feed,
    get queued() {
      return queued;
    },
    get importLines() {
      return importLines;
    },
  };
}
export type UserMessageController = ReturnType<typeof createUserMessageController>;
