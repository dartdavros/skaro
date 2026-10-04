import type { Task, AdrStatus } from './model.ts';

export interface NewTask {
  title: string;
  milestone?: string;
  dependsOn?: string[];
  body?: string;
  agent?: string;
  model?: string;
  order?: number;
  spec?: string;
  created?: string;
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'milestone'
    | 'status'
    | 'dependsOn'
    | 'unblocked'
    | 'archived'
    | 'order'
    | 'agent'
    | 'model'
    | 'branch'
    | 'spec'
    | 'body'
  >
>;

export interface NewAdr {
  title: string;
  body?: string;
  status?: AdrStatus;
  replaces?: string;
  date?: string;
}

export type NewSpec = NewAdr;
