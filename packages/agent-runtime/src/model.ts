import type {
  BuiltinSessionStart,
  Interaction,
  InteractionAnswer,
  PermissionMode,
  RouteSnapshot,
  RuntimeProcessIdentity,
  TimelineEvent,
  UserInput,
  RuntimeVerificationBinding,
  VerificationInspectRequest,
  VerificationCancelRequest,
  VerificationInspectReply,
  RuntimeExtensionBinding,
  RuntimeRpcRequest,
  RuntimeRpcReply,
  RuntimeModelBinding,
  RuntimeModelRequest,
  RuntimeModelRpcRequest,
  RuntimeModelRpcReply,
} from '@skaro/timeline';

export type RuntimeStart = BuiltinSessionStart;

export type RuntimeAction =
  | { type: 'send' | 'steer'; input: UserInput }
  | { type: 'respond'; interactionId: string; answer: InteractionAnswer }
  | { type: 'setModel'; model: string; effort?: string }
  | { type: 'setRoute'; route: RouteSnapshot }
  | { type: 'setPermissionMode'; mode: PermissionMode }
  | { type: 'rewind'; toItemId: string }
  | { type: 'compact' | 'interrupt' | 'close' }
  | { type: 'refreshContext' }
  | { type: 'stopBackground'; taskId: string };
// Tool calls use their caller command ID as the durable effect identity.
export type ToolAction = { type: 'tool'; name: string; args: unknown };
export type ModelTurnAction = { type: 'modelTurn'; request: RuntimeModelRequest; maxSteps: number };

export interface RuntimeCommand {
  id: string;
  action: RuntimeAction | ToolAction | ModelTurnAction;
}
export interface CommandResult {
  error?: string;
  value?: unknown;
}

export type RuntimeFact =
  | { type: 'created'; config: RuntimeStart; runtimeVersion: string }
  | { type: 'input'; id: string; turnId: string; input: UserInput; timestamp: number }
  | { type: 'route'; route: RouteSnapshot }
  | { type: 'permissions'; mode: PermissionMode }
  | { type: 'stopped' | 'closed' }
  | { type: 'interaction'; interaction: Interaction }
  | { type: 'answer'; interactionId: string; answer: InteractionAnswer }
  | { type: 'rewind'; toItemId: string }
  | { type: 'continuation'; route: RouteSnapshot; value: unknown }
  | { type: 'effect-intent'; id: string; name: string }
  | { type: 'effect-result'; id: string; result: unknown }
  | { type: 'effect-unknown'; id: string }
  | { type: 'recovery'; unknownEffects: string[] }
  | { type: 'timeline'; event: TimelineEvent }
  | { type: 'tool-request'; id: string; name: string; hash: string }
  | {
      type: 'process';
      id: string;
      owner: RuntimeProcessIdentity;
      state: 'running' | 'exited' | 'interrupted';
      code?: number | null;
      error?: string;
    };

export interface JournalRecord {
  schema: 2;
  sessionId: string;
  sequence: number;
  id: string;
  timestamp: number;
  previous: string;
  facts: RuntimeFact[];
  result: CommandResult;
  requestHash?: string;
  hash: string;
}

export interface RuntimeState {
  config?: RuntimeStart;
  runtimeVersion?: string;
  toolRequests: Record<string, { name: string; hash: string }>;
  processes: Record<
    string,
    {
      owner: RuntimeProcessIdentity;
      state: 'running' | 'exited' | 'interrupted';
      code?: number | null;
      error?: string;
    }
  >;
  stopped: boolean;
  closed: boolean;
  inputs: { id: string; turnId: string }[];
  rewindBefore?: string;
  interactions: Record<string, Interaction>;
  answered: Record<string, InteractionAnswer>;
  effects: Record<
    string,
    { name: string; state: 'pending' | 'unknown' | 'completed'; result?: unknown }
  >;
  continuation?: { route: RouteSnapshot; value: unknown };
}

export type ParentMessage =
  | {
      type: 'start';
      config: RuntimeStart;
      owner: RuntimeProcessIdentity;
      verification?: RuntimeVerificationBinding;
      extensions?: RuntimeExtensionBinding;
      model?: RuntimeModelBinding;
    }
  | { type: 'command'; command: RuntimeCommand }
  | VerificationInspectReply
  | RuntimeRpcReply
  | RuntimeModelRpcReply;
export type RuntimeMessage =
  | { type: 'ready'; records: JournalRecord[] }
  | { type: 'record'; record: JournalRecord }
  | { type: 'reply'; id: string; result: CommandResult }
  | { type: 'fatal'; error: string }
  | VerificationInspectRequest
  | VerificationCancelRequest
  | RuntimeRpcRequest
  | RuntimeModelRpcRequest;
