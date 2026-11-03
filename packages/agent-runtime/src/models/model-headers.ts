export type ModelAuthentication = 'bearer' | 'anthropic';
export function modelHeaders(
  authentication: ModelAuthentication,
  key: string,
): Record<string, string> {
  return authentication === 'anthropic'
    ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
