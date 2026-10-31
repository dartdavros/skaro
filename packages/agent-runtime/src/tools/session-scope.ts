import type { RuntimeJournal } from '../journal.ts';
import { PathScope } from './path-scope.ts';

/** One private-path policy for tools, context and skills. */
export function sessionFileScope(journal: RuntimeJournal): Promise<PathScope> {
  const config = journal.state.config!;
  const tools = config.tools;
  if (!tools) throw new Error('Host file scope is not configured');
  const primary = config.journalPath;
  return PathScope.create(tools.cwd, tools.readDirs, [
    tools.artifactDir,
    primary,
    `${primary}.index.sqlite`,
    `${primary}.index.sqlite-journal`,
    `${primary}.index.sqlite-wal`,
    `${primary}.index.sqlite-shm`,
  ]);
}
