import { managedContextArgument } from './managed-cache-context';

/** Same relative-path contract as the task selector; preserve the legacy default npm identity. */
export function dependencyConfiguration(
  configuration: unknown,
  manifestDigest: string,
  sourceContext = '.',
) {
  try {
    managedContextArgument(sourceContext);
  } catch (error) {
    throw new Error('managed_dependencies_context_invalid', { cause: error });
  }
  const legacy = [configuration, manifestDigest];
  return sourceContext === '.' ? legacy : [...legacy, { sourceContext }];
}
