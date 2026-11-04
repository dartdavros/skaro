import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import { expect, it } from 'vitest';
import { restoreHistory } from '../restore-history';
import { catPilotProjectId } from '../verification/cat-pilot-state';
import { background, closeBackground, setBackgroundProjectScope } from './client';
import { PayloadStore } from './payload-store';

const profile = process.env['SKARO_CHAT_SOURCE_PROFILE'];

it.skipIf(!profile)(
  'prepares a real chat while the workspace writer is busy',
  async () => {
    const projectId = catPilotProjectId(profile!);
    const registry = AppDb.readOnly(join(profile!, 'skaro.db'));
    const directory = await mkdtemp(join(tmpdir(), 'skaro-chat-preparation-'));
    const workspace = new PayloadStore(directory);
    try {
      setBackgroundProjectScope(directory, projectId);
      const project = registry.getProject(projectId)!;
      const chat = registry
        .listChats(projectId)
        .find((c) => existsSync(join(profile!, c.logPath)))!;
      workspace.db.exec('BEGIN IMMEDIATE');
      const [history, artifacts] = await Promise.all([
        restoreHistory(
          directory,
          join(profile!, chat.logPath),
          chat.createdAt,
          chat.agent,
          projectId,
        ),
        background(directory, 'artifacts.load', project.path, {}, 0, true),
      ]);
      expect(history.timeline.state.items.length).toBeGreaterThan(0);
      expect(artifacts.value.architecture).toBeDefined();
    } finally {
      workspace.db.close();
      registry.close();
      await closeBackground();
      await rm(directory, { recursive: true, force: true });
    }
  },
  90_000,
);
