export class ModelHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Model service rejected the request (HTTP ${status})`);
    this.status = status;
  }
}

const safeMessages = new Set([
  'Model stream reported an error',
  'Model response is incomplete or filtered',
  'Model service did not return an event stream',
  'Model stream ended without its terminal marker',
  'Invalid model choices',
  'Unexpected model choice index',
  'Invalid model object',
  'Invalid model text delta',
  'Model stream provenance changed',
  'Model data arrived after completion',
  'Unindexed streaming reasoning is unsupported',
  'Native reasoning metadata changed',
  'Incomplete model tool calls',
  'Sensitive model response rejected',
]);
/** Only known static diagnostics cross the credential/journal boundary. */
export class ModelProtocolError extends Error {
  constructor(message: string) {
    super(safeMessages.has(message) ? message : 'Model transport or protocol failed');
  }
}
export function modelFailure(error: unknown): ModelHttpError | ModelProtocolError {
  if (error instanceof ModelHttpError) return new ModelHttpError(error.status);
  if (error instanceof Error) return new ModelProtocolError(error.message);
  return new ModelProtocolError('unknown');
}
