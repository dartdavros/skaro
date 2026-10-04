import { ArtifactFiles, SKARO_DIR } from './files.ts';
import { str, obj } from './conversion.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type {
  ArtifactProblem,
  ProjectConfig,
  ConfigDefaults,
  InheritableSetting,
} from './model.ts';
import { DEFAULT_CONFIG } from './model.ts';
import { readChecks } from './checks.ts';
import { environmentYaml, readEnvironment } from './environment.ts';

export async function readConfig(
  files: ArtifactFiles,
  defaults: () => ConfigDefaults,
  problems: ArtifactProblem[],
): Promise<ProjectConfig> {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(await readFile(join(files.dir, 'config.yaml'), 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      raw = parsed as Record<string, unknown>;
    } else if (parsed !== null && parsed !== undefined) {
      problems.push({ path: `${SKARO_DIR}/config.yaml`, message: 'Config must be a YAML mapping' });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      problems.push({ path: `${SKARO_DIR}/config.yaml`, message: String(error) });
    }
  }
  const merge = obj(raw['merge']);
  const chat = obj(raw['chat']);
  const strategy = str(merge['strategy']);
  const isolation = str(raw['isolation']) ?? defaults().isolation;
  const permission = str(raw['permission_mode']);
  const app = defaults();
  const bool = (value: unknown, fallback: boolean | undefined, base: boolean): boolean =>
    typeof value === 'boolean' ? value : (fallback ?? base);
  const environment = readEnvironment(raw['environment'], problems);
  return {
    ...(environment ? { environment } : {}),
    checks: readChecks(raw['checks'], problems),
    defaultAgent: str(raw['default_agent']) ?? DEFAULT_CONFIG.defaultAgent,
    defaultModel: str(raw['default_model']),
    defaultEffort: str(raw['default_effort']),
    permissionMode: permission === 'ask' || permission === 'full' ? permission : 'auto',
    baseBranch: str(raw['base_branch']) ?? app.baseBranch ?? DEFAULT_CONFIG.baseBranch,
    branchTemplate:
      str(raw['branch_template']) ?? app.branchTemplate ?? DEFAULT_CONFIG.branchTemplate,
    isolation: isolation === 'in-place' ? 'in-place' : 'worktree',
    merge: {
      strategy:
        strategy === 'merge' || strategy === 'rebase' || strategy === 'squash'
          ? strategy
          : (app.mergeStrategy ?? 'squash'),
      deleteBranch: bool(merge['delete_branch'], app.deleteBranch, true),
    },
    chat: { autoAcceptDocs: bool(chat['auto_accept_docs'], app.autoAcceptDocs, true) },
    agentFiles: bool(raw['agent_files'], app.agentFiles, false),
    agentInstructions: str(raw['agent_instructions']),
    ...(app.agentInstructions?.trim() ? { globalInstructions: app.agentInstructions.trim() } : {}),
  };
}

export async function writeConfig(
  files: ArtifactFiles,
  config: ProjectConfig,
  inherited: InheritableSetting[] = [],
): Promise<void> {
  const own = <T>(key: InheritableSetting, value: T): T | undefined =>
    inherited.includes(key) ? undefined : value;
  const merge = {
    strategy: own('mergeStrategy', config.merge.strategy),
    delete_branch: own('deleteBranch', config.merge.deleteBranch),
  };
  const autoAccept = own('autoAcceptDocs', config.chat.autoAcceptDocs);
  const yaml = stringifyYaml({
    default_agent: config.defaultAgent,
    default_model: config.defaultModel,
    default_effort: config.defaultEffort,
    permission_mode: config.permissionMode,
    base_branch: own('baseBranch', config.baseBranch),
    branch_template: own('branchTemplate', config.branchTemplate),
    isolation: own('isolation', config.isolation),
    checks: config.checks.length ? config.checks : undefined,
    environment: environmentYaml(config.environment),
    merge: merge.strategy === undefined && merge.delete_branch === undefined ? undefined : merge,
    chat: autoAccept === undefined ? undefined : { auto_accept_docs: autoAccept },
    agent_files: own('agentFiles', config.agentFiles),
    agent_instructions: config.agentInstructions,
  });
  await files.writeFile('config.yaml', yaml);
}
