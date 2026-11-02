import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import {
  builtinChatSettingsKey,
  parseBuiltinChatSettings,
  saveBuiltinChatSettings,
} from './builtin-chat-settings';

const selection = {
  agent: 'skaro' as const,
  model: 'route-marker',
  permissionMode: 'ask' as const,
};

it('requires explicit chat route/permissions and refuses task-only authority or provider defaults', () => {
  expect(parseBuiltinChatSettings(selection)).toEqual(selection);
  for (const input of [
    null,
    {},
    { ...selection, agent: 'codex' },
    { ...selection, model: '' },
    { ...selection, permissionMode: undefined },
    { ...selection, permissionMode: 'auto' },
    { ...selection, effort: '' },
    { ...selection, isolation: 'worktree' },
    { ...selection, planFirst: true },
  ])
    expect(() => parseBuiltinChatSettings(input)).toThrow();
});

it('stores exact builtin chat choices separately from managed settings without creating a chat', () => {
  const db = AppDb.open(':memory:');
  try {
    const managed = { model: 'managed-marker', permissionMode: 'full' };
    db.setSetting('chat.settings-marker.agent', managed);
    saveBuiltinChatSettings(db, 'settings-marker', selection);
    expect(
      parseBuiltinChatSettings(db.getSetting(builtinChatSettingsKey('settings-marker'), null)),
    ).toEqual(selection);
    expect(db.getSetting('chat.settings-marker.agent', null)).toEqual(managed);
    expect(() =>
      parseBuiltinChatSettings(db.getSetting(builtinChatSettingsKey('absent-marker'), null)),
    ).toThrow();
    expect(db.listProjects()).toEqual([]);
    expect(db.listChats('settings-marker')).toEqual([]);
  } finally {
    db.close();
  }
});
