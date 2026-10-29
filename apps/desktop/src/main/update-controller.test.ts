import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentInstaller } from '@skaro/core';
import type { ReleaseManifest } from './update-release';
import type { PendingUpdate, UpdateJournal } from './update-journal';
import { UpdateActivity } from './update-activity';
import { Updates } from './update-controller';

// Pure controller inputs: the published release, payload and agent checks are replaced in memory.
const published = vi.hoisted(() => ({ release: undefined as unknown }));
vi.mock('./update-feed', () => ({ fetchRelease: async () => published.release }));
vi.mock('./update-journal', () => ({}));
vi.mock('./update-payload', () => ({ verifyPayload: async () => undefined }));
vi.mock('./update-agents', () => ({
  prepareAgents: async () => undefined,
  verifyAgents: async () => undefined,
}));

const agents = {
  codex: { version: '0.159.2', shownVersion: '0.159.2' },
  'claude-code': { version: '0.3.285', shownVersion: '2.1.285' },
};
const current = {
  bundleVersion: '2.2.7',
  skaroVersion: '2.2.7',
  claudeSdk: '0.3.285',
  adapters: { codex: '0.0.0', 'claude-code': '0.0.0' },
  agents,
};
const release = (version: string) =>
  ({
    ...current,
    bundleVersion: version,
    skaroVersion: version,
    platforms: { 'win32-x64': {} },
  }) as unknown as ReleaseManifest;

function updates(saved: { pending?: PendingUpdate }) {
  const journal = {
    read: async () => saved.pending,
    save: async (value: PendingUpdate) => void (saved.pending = structuredClone(value)),
  } as unknown as UpdateJournal;
  return new Updates({
    current,
    platform: { os: 'win32', arch: 'x64' },
    installer: {} as AgentInstaller,
    journal,
    activity: new UpdateActivity(() => false),
    installed: async () => [],
    driver: {
      download: async (manifest) => [`C:\\updates\\Skaro-${manifest.bundleVersion}.exe`],
      apply: () => undefined,
    },
    emit: () => undefined,
    fetch: fetch,
    executable: 'C:\\Programs\\Skaro\\Skaro.exe',
    installable: true,
  });
}

describe('update target', () => {
  beforeEach(() => {
    published.release = undefined;
  });

  it('downloads the release published after the check that offered an older one', async () => {
    const saved: { pending?: PendingUpdate } = {};
    const controller = updates(saved);
    published.release = release('2.2.8');
    expect((await controller.check()).components[0]?.latest).toBe('2.2.8');
    published.release = release('2.2.9');
    const state = await controller.download();
    expect(state).toMatchObject({ phase: 'ready', components: [{ latest: '2.2.9' }] });
    expect(saved.pending?.manifest.bundleVersion).toBe('2.2.9');
  });

  it('offers a newer release over a downloaded one and keeps the download otherwise', async () => {
    const saved: { pending?: PendingUpdate } = {
      pending: { manifest: release('2.2.8'), agents: [], files: ['C:\\u.exe'], applying: false },
    };
    const controller = updates(saved);
    await controller.initialize();
    published.release = release('2.2.8');
    expect((await controller.check()).components[0]?.latest).toBe('2.2.8');
    published.release = release('2.2.9');
    expect(await controller.check()).toMatchObject({
      phase: 'available',
      components: [{ latest: '2.2.9' }],
    });
    await controller.download();
    expect(saved.pending?.manifest.bundleVersion).toBe('2.2.9');
  });
});
