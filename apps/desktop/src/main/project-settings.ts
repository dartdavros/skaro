// "Параметры проекта" (ProjectSettings mockup): .skaro/config.yaml as the screen edits it. Values
// equal to the app-wide defaults ("Настройки") are not written, so the project keeps following them.

import type { InheritableSetting, ProjectConfig } from '@skaro/core';
import { BUILT_IN_DEFAULTS, type ProjectDefaults, type ProjectSettings } from '../shared/ipc';
import { syncAgentFiles } from './agent-files';
import type { Projects } from './projects';

export function toSettings(config: ProjectConfig): ProjectSettings {
  return {
    defaultAgent: config.defaultAgent === 'codex' ? 'codex' : 'claude-code',
    ...(config.defaultModel ? { defaultModel: config.defaultModel } : {}),
    ...(config.defaultEffort ? { defaultEffort: config.defaultEffort } : {}),
    permissionMode: config.permissionMode,
    baseBranch: config.baseBranch,
    branchTemplate: config.branchTemplate,
    isolation: config.isolation,
    mergeStrategy: config.merge.strategy,
    deleteBranch: config.merge.deleteBranch,
    autoAcceptDocs: config.chat.autoAcceptDocs,
    agentFiles: config.agentFiles,
    agentInstructions: config.agentInstructions ?? '',
  };
}

export function toConfig(s: ProjectSettings, checks: ProjectConfig['checks'] = []): ProjectConfig {
  return {
    checks,
    defaultAgent: s.defaultAgent,
    ...(s.defaultModel ? { defaultModel: s.defaultModel } : {}),
    ...(s.defaultEffort ? { defaultEffort: s.defaultEffort } : {}),
    permissionMode: s.permissionMode,
    baseBranch: s.baseBranch.trim() || 'main',
    branchTemplate: s.branchTemplate.trim() || 'skaro/{id}-{slug}',
    isolation: s.isolation,
    merge: { strategy: s.mergeStrategy, deleteBranch: s.deleteBranch },
    chat: { autoAcceptDocs: s.autoAcceptDocs },
    agentFiles: s.agentFiles,
    ...(s.agentInstructions.trim() ? { agentInstructions: s.agentInstructions.trim() } : {}),
  };
}

/** The defaults as they apply now: "Настройки" over the built-in values. */
export function appDefaults(projects: Projects): ProjectDefaults {
  return { ...BUILT_IN_DEFAULTS, ...projects.defaults() };
}

const INHERITABLE: InheritableSetting[] = [
  'baseBranch',
  'branchTemplate',
  'isolation',
  'mergeStrategy',
  'deleteBranch',
  'autoAcceptDocs',
  'agentFiles',
];

export async function projectSettings(
  projects: Projects,
  projectId: string,
): Promise<ProjectSettings> {
  return toSettings((await projects.get(projectId).load()).config);
}

export async function saveProjectSettings(
  projects: Projects,
  projectId: string,
  settings: ProjectSettings,
  locale: string,
): Promise<void> {
  const context = projects.get(projectId);
  const artifacts = await context.load();
  const problems = artifacts.problems.filter((problem) => problem.path === '.skaro/config.yaml');
  if (problems.length) throw new Error(problems.map((problem) => problem.message).join('\n'));
  const before = artifacts.config;
  const defaults = appDefaults(projects);
  const inherited = INHERITABLE.filter((key) => settings[key] === defaults[key]);
  // The screen does not edit checks and the task environment: they stay as the file has them.
  const next = toConfig(settings, before.checks);
  await context.store.writeConfig(
    { ...next, ...(before.environment ? { environment: before.environment } : {}) },
    inherited,
  );
  context.invalidate();
  if (before.agentFiles !== settings.agentFiles) {
    await syncAgentFiles(context.root, settings.agentFiles, locale);
  }
}

/**
 * "Настройки" changed the defaults: every project reads its settings anew, and projects that now
 * keep (or drop) the Skaro block in AGENTS.md / CLAUDE.md get it written (or removed).
 */
export async function saveAppDefaults(
  projects: Projects,
  ids: string[],
  next: ProjectDefaults,
  save: (value: ProjectDefaults) => void,
  locale: string,
): Promise<void> {
  const before = new Map<string, boolean>();
  for (const id of ids) {
    const config = await projects
      .get(id)
      .load()
      .catch(() => undefined);
    if (config) before.set(id, config.config.agentFiles);
  }
  save(next);
  projects.defaultsChanged();
  for (const [id, had] of before) {
    const context = projects.get(id);
    const now = (await context.load()).config.agentFiles;
    if (now !== had) await syncAgentFiles(context.root, now, locale);
  }
}
