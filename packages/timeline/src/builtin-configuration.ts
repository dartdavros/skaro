import type { Connection, Route } from './builtin-model.ts';

/** Nonsecret persisted choices. Availability/capability admission remains a separate host check. */
export interface BuiltinModelConfiguration {
  schema: 1;
  revision: number;
  connections: readonly Connection[];
  routes: readonly Route[];
}
