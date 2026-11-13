import { delimiter } from 'node:path';

/** Worker process.env is case-sensitive even on Windows; spawn must receive one PATH spelling. */
export function appServerEnvironment(
  inherited: NodeJS.ProcessEnv,
  extra: NodeJS.ProcessEnv,
  directories: readonly string[],
): NodeJS.ProcessEnv {
  const result = { ...inherited, ...extra };
  const pathKey = (key: string) =>
    process.platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH';
  const path =
    Object.entries(extra).find(([key]) => pathKey(key))?.[1] ??
    Object.entries(inherited).find(([key]) => pathKey(key))?.[1] ??
    '';
  for (const key of Object.keys(result)) if (pathKey(key)) delete result[key];
  result.PATH = [...directories, path].filter(Boolean).join(delimiter);
  return result;
}
