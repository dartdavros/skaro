import { ArtifactFiles } from './files.ts';
export { SKARO_DIR } from './files.ts';
export type { NewTask, TaskPatch, NewAdr, NewSpec } from './inputs.ts';
import * as tasks from './tasks.ts';
import * as milestones from './milestones.ts';
import * as documents from './documents.ts';
import * as configOps from './config.ts';
import * as load from './load.ts';
import type {
  Adr,
  AdrStatus,
  Doc,
  Milestone,
  ProjectArtifacts,
  Spec,
  SpecStatus,
  ProjectConfig,
  Task,
  ConfigDefaults,
  InheritableSetting,
} from './model.ts';
import type { NewTask, TaskPatch, NewAdr, NewSpec } from './inputs.ts';
import { slugify } from './slug.ts';

/** Public artifact API; persistence operations are composed by responsibility. */
export class ArtifactStore {
  readonly root: string;
  private readonly files: ArtifactFiles;
  private readonly defaults: () => ConfigDefaults;
  constructor(projectRoot: string, defaults: () => ConfigDefaults = () => ({})) {
    this.root = projectRoot;
    this.files = new ArtifactFiles(projectRoot);
    this.defaults = defaults;
  }
  readTask(id: string): Promise<Task> {
    return tasks.readTask(this.files, id);
  }
  createTask(input: NewTask): Promise<Task> {
    return tasks.createTask(this.files, input);
  }
  updateTask(id: string, patch: TaskPatch): Promise<Task> {
    return tasks.updateTask(this.files, id, patch);
  }
  deleteTask(id: string): Promise<void> {
    return tasks.deleteTask(this.files, id);
  }
  createMilestone(input: { title: string; body?: string; order?: number }): Promise<Milestone> {
    return milestones.createMilestone(this.files, input);
  }
  updateMilestone(
    id: string,
    patch: Partial<Pick<Milestone, 'title' | 'order' | 'body' | 'branch'>>,
  ): Promise<Milestone> {
    return milestones.updateMilestone(this.files, id, patch);
  }
  deleteMilestone(id: string, moveTasksTo?: string): Promise<void> {
    return milestones.deleteMilestone(this.files, id, moveTasksTo);
  }
  createAdr(input: NewAdr): Promise<Adr> {
    return documents.createAdr(this.files, input);
  }
  setAdrStatus(id: string, status: AdrStatus): Promise<Adr> {
    return documents.setAdrStatus(this.files, id, status);
  }
  writeAdr(id: string, body: string): Promise<Adr> {
    return documents.writeAdr(this.files, id, body);
  }
  createSpec(input: NewSpec): Promise<Spec> {
    return documents.createSpec(this.files, input);
  }
  setSpecStatus(id: string, status: SpecStatus): Promise<Spec> {
    return documents.setSpecStatus(this.files, id, status);
  }
  writeSpec(id: string, body: string): Promise<Spec> {
    return documents.writeSpec(this.files, id, body);
  }
  writeDoc(path: string, body: string): Promise<Doc> {
    return documents.writeDoc(this.files, path, body);
  }
  deleteDoc(path: string): Promise<void> {
    return documents.deleteDoc(this.files, path);
  }
  writeConfig(config: ProjectConfig, inherited: InheritableSetting[] = []): Promise<void> {
    return configOps.writeConfig(this.files, config, inherited);
  }
  load(): Promise<ProjectArtifacts> {
    return load.load(this.files, this.defaults);
  }
  watch(onChange: (paths: string[]) => void, debounceMs = 150): () => void {
    return this.files.watch(onChange, debounceMs);
  }
}

/** Branch name for a task, or for a milestone, from the config template (`skaro/{id}-{slug}`). */
export function taskBranch(
  config: ProjectConfig,
  task: Pick<Task | Milestone, 'id' | 'title'>,
): string {
  return config.branchTemplate
    .replaceAll('{id}', task.id)
    .replaceAll('{slug}', slugify(task.title, 30));
}
