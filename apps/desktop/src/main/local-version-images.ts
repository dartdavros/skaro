import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { ComposeModel } from './task-compose-ports';

/** The deployment consumes already verified images, never a mutable tag or an implicit rebuild. */
export async function localImageVariables(
  dataDir: string,
  projectId: string,
  receiptId: string,
  phase: 'install' | 'rollback',
  observed: { model: ComposeModel; composeFile: string; variables: Record<string, string> },
  images: Record<string, string>,
): Promise<Record<string, string>> {
  if (
    Object.keys(observed.model.services).sort().join('\n') !== Object.keys(images).sort().join('\n')
  )
    throw new Error('Local target service composition differs from the verified image manifest');
  if (Object.values(images).some((id) => !/^sha256:[a-f0-9]{64}$/.test(id)))
    throw new Error('Local installation requires immutable image IDs');
  const directory = join(dataDir, 'local-installations', projectId, receiptId);
  await mkdir(directory, { recursive: true });
  const override = join(directory, `${phase}.json`);
  await writeFile(
    override,
    JSON.stringify({
      services: Object.fromEntries(
        Object.entries(images).map(([service, image]) => [service, { image }]),
      ),
    }),
  );
  return {
    ...observed.variables,
    COMPOSE_PATH_SEPARATOR: delimiter,
    COMPOSE_FILE: [observed.composeFile, override].join(delimiter),
  };
}
