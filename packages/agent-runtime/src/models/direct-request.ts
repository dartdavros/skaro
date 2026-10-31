import { z } from 'zod';
import { validateModelEndpoint, type RouteSnapshot } from '@skaro/timeline';

export function requireDirectProfile(
  route: RouteSnapshot,
  connector: string,
  profile: string,
): void {
  validateModelEndpoint(route.endpoint);
  if (
    route.connector !== connector ||
    route.apiProfile.id !== profile ||
    route.apiProfile.revision !== 1 ||
    !route.modelId
  )
    throw new Error('Unsupported direct model API profile');
  const policy = route.upstream;
  if (policy.selection !== 'service-default' || policy.allow.length || policy.allowFallback)
    throw new Error('Direct API does not implement gateway routing/fallback policy');
}
export function modelParameters<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('Unsupported or invalid direct model parameters');
  return result.data;
}
export const sampling = {
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
};
