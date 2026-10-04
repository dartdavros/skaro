import type { DocEntry, TaskStatus } from '../../../shared/ipc';
import type { AdrStatus } from './model';

export type HeaderProps = {
  doc: DocEntry;
  now: number;
  /** Tasks that link to the specification. */
  tasks?: { id: string; title: string; status: TaskStatus }[];
  ondiscuss: () => void;
  onedit: () => void;
  onreveal: () => void;
  onstatus: (status: AdrStatus) => void;
  /** An ADR or a specification of the same kind, by number. */
  onadr: (id: string) => void;
  ontask: (id: string) => void;
};
