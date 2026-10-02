import type { ArtifactProblem, ProjectCheck } from './model.ts';

/** Invalid checks must block merging, rather than silently disable verification. */
export function readChecks(raw: unknown, problems: ArtifactProblem[]): ProjectCheck[] {
  if (raw === undefined) return [];
  const fail = () =>
    problems.push({
      path: '.skaro/config.yaml',
      message: 'checks must be a list of non-empty { name, run } commands',
    });
  if (!Array.isArray(raw)) {
    fail();
    return [];
  }
  const checks: ProjectCheck[] = [];
  for (const entry of raw) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.name !== 'string' ||
      !entry.name.trim() ||
      typeof entry.run !== 'string' ||
      !entry.run.trim()
    ) {
      fail();
      continue;
    }
    checks.push({ name: entry.name, run: entry.run });
  }
  return checks;
}
