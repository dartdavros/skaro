import { expect, it, vi } from 'vitest';
import { ChatConfiguration } from './chat-settings';

it('keeps the saved chat permissions unchanged until the live session accepts the switch', async () => {
  const saved = new Map<string, unknown>();
  let accept!: () => void;
  const setPermissionMode = vi.fn(() => new Promise<void>((resolve) => (accept = resolve)));
  const changed = vi.fn();
  // Exercise the actual settings method; no backend, agent process or HTTP server is started.
  const context = {
    ctx: {
      history: {
        restore: async () => ({ chat: { agent: 'codex' }, session: { setPermissionMode } }),
      },
      deps: { db: { setSetting: (key: string, value: unknown) => saved.set(key, value) } },
      listChanged: changed,
    },
    settings: () => ({ agent: 'codex' }),
  } as unknown as ChatConfiguration;
  const switchMode = ChatConfiguration.prototype.setSettings.call(context, 'project', 'chat', {
    agent: 'codex',
    permissionMode: 'full',
  });
  await vi.waitFor(() => expect(setPermissionMode).toHaveBeenCalledWith('full'));
  expect(saved.size).toBe(0);
  accept();
  await switchMode;
  expect([...saved.values()]).toContainEqual({ permissionMode: 'full' });
  expect(changed).toHaveBeenCalledWith('project', 'chat');

  saved.clear();
  setPermissionMode.mockRejectedValueOnce(new Error('switch failed'));
  await expect(
    ChatConfiguration.prototype.setSettings.call(context, 'project', 'chat', {
      agent: 'codex',
      permissionMode: 'full',
    }),
  ).rejects.toThrow('switch failed');
  expect(saved.size).toBe(0);
});
