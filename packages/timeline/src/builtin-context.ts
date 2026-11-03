/** Host configuration only. Repository/MCP/model text cannot create an owner decision. */
export interface BuiltinContextConfig {
  /** Directory within cwd whose ancestor AGENTS.md files apply. */
  scopePath: string;
  pins: readonly {
    id: string;
    kind: 'goal' | 'constraint' | 'decision' | 'open-question' | 'evidence' | 'note';
    origin: 'host' | 'owner';
    revision: string;
    text: string;
  }[];
  documents: readonly {
    id: string;
    path: string;
    kind: 'task' | 'adr' | 'c4' | 'document' | 'skill';
  }[];
}
