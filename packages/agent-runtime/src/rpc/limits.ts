export interface RuntimeRpcLimits {
  requestBytes: number;
  replyBytes: number;
  textBytes: number;
}
export const DEFAULT_RPC_LIMITS: RuntimeRpcLimits = {
  requestBytes: 65_536,
  replyBytes: 262_144,
  textBytes: 0,
};
export const MODEL_RPC_LIMITS: RuntimeRpcLimits = {
  requestBytes: 2_097_152,
  replyBytes: 16_777_216,
  textBytes: 1_048_576,
};
