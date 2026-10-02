import { obj, str, type Obj } from '@skaro/timeline';
import type { CodexProjectionState } from './projector-state.ts';

export class CodexTransport {
  private readonly state: CodexProjectionState;
  constructor(state: CodexProjectionState) {
    this.state = state;
  }
  /** One JSON-RPC message Skaro sent to the app-server. */
  input(line: unknown): void {
    const msg = obj(line);
    if (!msg) return;
    try {
      const id = msg['id'];
      if (typeof msg['method'] === 'string' && id !== undefined) {
        this.state.requests.set(String(id), msg['method']);
        if (msg['method'] === 'turn/start')
          this.state.turns.onTurnStartRequest(obj(msg['params']) ?? {});
        if (msg['method'] === 'thread/revert') {
          this.state.revertTurn = str(obj(msg['params'])?.['beforeTurnId']);
        }
      } else if (id !== undefined && ('result' in msg || 'error' in msg)) {
        this.state.requestHandler.closeInteraction(String(id));
      }
    } catch (error) {
      this.state.emitUnknown(msg, error);
    }
  }

  /** One JSON-RPC message the app-server sent. */
  output(line: unknown): void {
    const msg = obj(line);
    if (!msg) return;
    try {
      const method = str(msg['method']);
      const id = msg['id'];
      if (method && id !== undefined)
        this.state.requestHandler.onServerRequest(String(id), method, obj(msg['params']) ?? {});
      else if (method) this.state.notifications.onNotification(method, obj(msg['params']) ?? {});
      else if (id !== undefined) this.state.transport.onResponse(String(id), msg);
    } catch (error) {
      this.state.emitUnknown(msg, error);
    }
  }

  onResponse(id: string, msg: Obj): void {
    const method = this.state.requests.get(id);
    this.state.requests.delete(id);
    const result = obj(msg['result']);
    if (
      (method === 'thread/start' || method === 'thread/resume' || method === 'thread/fork') &&
      result
    ) {
      this.state.mainThread = str(obj(result['thread'])?.['id']) ?? this.state.mainThread;
      this.state.emit({
        t: 'session.started',
        nativeSessionId: str(obj(result['thread'])?.['id']) ?? '',
        model: str(result['model']) ?? '',
        capabilities: { agentVersion: str(obj(result['thread'])?.['cliVersion']) },
      });
    }
    const error = obj(msg['error']);
    if (error && method === 'turn/start') {
      this.state.notice(
        `rpc-${id}`,
        'error',
        'other',
        str(error['message']) ?? 'turn/start failed',
      );
    }
  }
}
