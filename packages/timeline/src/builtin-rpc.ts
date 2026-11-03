/** Private native/runtime transport. Scope and admissions are never caller arguments. */
export type RuntimeRpcRequest =
  | { type: 'runtime-rpc-call'; id: string; operation: string; args: unknown }
  | { type: 'runtime-rpc-cancel'; id: string };
export interface RuntimeRpcReply {
  type: 'runtime-rpc-result';
  id: string;
  value?: unknown;
  error?: true;
}
export interface RuntimeRpcProgress {
  type: 'runtime-rpc-progress';
  id: string;
  text: string;
}
