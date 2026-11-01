const safeNames = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'AssertionError',
  'AbortError',
  'TimeoutError',
  'ModelHttpError',
  'ModelProtocolError',
]);

/** Only bounded diagnostic metadata may leave a credential host; never raw error text. */
export function liveFailure(stage: string, error: unknown) {
  const failure = error as { name?: unknown; code?: unknown; status?: unknown } | null;
  const integer = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
      ? value
      : undefined;
  return {
    type: 'failed',
    stage,
    name: typeof failure?.name === 'string' && safeNames.has(failure.name) ? failure.name : 'Error',
    code: integer(failure?.code, 0, 65_535),
    status: integer(failure?.status, 100, 599),
  };
}
