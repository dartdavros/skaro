import { expect, type ElectronApplication } from '@playwright/test';

/** Crash only this real verification host, immediately after its durable checkpoint appears. */
export async function crashAtCheckpoint(
  app: ElectronApplication,
  project: string,
  action: () => Promise<unknown>,
  checkpoint: () => string | undefined,
) {
  const main = await app.evaluate(() => ({
    pid: process.pid,
    scope: process.env.SKARO_VERIFICATION_PROJECT,
    role: process.type,
  }));
  expect(main).toMatchObject({ scope: project, role: 'browser' });
  let failure: unknown;
  void action().catch((error: unknown) => {
    failure = error;
  });
  const deadline = Date.now() + 45_000;
  let id: string | undefined;
  while (Date.now() < deadline) {
    id = checkpoint();
    if (id) {
      process.kill(main.pid, 'SIGKILL');
      break;
    }
    if (failure) throw failure;
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
  if (!id) throw new Error('The requested durable checkpoint was not observed');
  await expect
    .poll(() => {
      try {
        process.kill(main.pid, 0);
        return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
        throw error;
      }
    })
    .toBe(true);
  return id;
}
