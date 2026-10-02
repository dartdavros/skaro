import { arr, obj, str, type Obj } from '@skaro/timeline';
import { AGENT, SILENT_TYPES } from './projector-helpers.ts';
import type { ClaudeProjectionState } from './projector-state.ts';

export class ClaudeTransportProjection {
  private readonly state: ClaudeProjectionState;
  constructor(state: ClaudeProjectionState) {
    this.state = state;
  }
  /** One JSON line Skaro wrote to the CLI's stdin. */
  input(line: unknown): void {
    const msg = obj(line);
    if (!msg) return;
    try {
      if (msg['type'] === 'user') this.onUserInput(msg);
      else if (msg['type'] === 'control_response') this.onControlResponse(msg);
      else if (msg['type'] === 'control_request') {
        const request = obj(msg['request']);
        const toItemId = str(request?.['user_message_id']);
        if (request?.['subtype'] === 'rewind_files' && toItemId && !request['dry_run']) {
          this.state.emit({ t: 'rewound', toItemId });
        }
      }
    } catch (error) {
      this.state.emitUnknown(msg, error);
    }
  }

  /** One JSON line the CLI wrote to stdout. */
  output(line: unknown): void {
    const msg = obj(line);
    if (!msg) return;
    try {
      this.onOutput(msg);
    } catch (error) {
      this.state.emitUnknown(msg, error);
    }
  }

  // ── stdin ────────────────────────────────────────────────────────────────

  onUserInput(msg: Obj): void {
    const message = obj(msg['message']);
    const content = message?.['content'];
    // Tool results written by Skaro are not user turns.
    const text =
      typeof content === 'string'
        ? content
        : arr(content)
            .map((b) => (obj(b)?.['type'] === 'text' ? str(obj(b)?.['text']) : undefined))
            .filter((t): t is string => t !== undefined)
            .join('\n');
    if (!text && !arr(content).some((b) => obj(b)?.['type'] === 'image')) return;
    const images = arr(content).filter((b) => obj(b)?.['type'] === 'image');

    // A message sent while a turn runs is picked up by the agent between steps.
    if (!this.state.turnOpen) this.state.startTurn();
    const id = str(msg['uuid']) ?? `user-${this.state.turnId}-${this.state.items.size}`;
    this.state.upsert({
      id,
      kind: 'message',
      role: 'user',
      text,
      // Queued until the CLI picks it up (command_lifecycle) or answers.
      status: 'queued',
      native: { agent: AGENT, type: 'user', ref: id },
    });
    for (const block of images) {
      const source = obj(obj(block)?.['source']);
      const data = str(source?.['data']);
      if (!data) continue;
      this.state.upsert({
        id: `${id}-img-${this.state.items.size}`,
        kind: 'image',
        source: 'viewed',
        image: this.state.ctx.attachImage({
          base64: data,
          mime: str(source?.['media_type']) ?? 'image/png',
        }),
        status: 'done',
        native: { agent: AGENT, type: 'user.image', ref: id },
      });
    }
  }

  onControlResponse(msg: Obj): void {
    const response = obj(msg['response']);
    const requestId = str(response?.['request_id']);
    if (!requestId) return;
    const interaction = this.state.openRequests.get(requestId);
    if (!interaction) return;
    this.state.openRequests.delete(requestId);
    this.state.emit({ t: 'interaction.closed', id: interaction.id, resolution: 'answered' });

    const payload = obj(response?.['response']);
    const toolUseId = str(payload?.['toolUseID']);
    if (payload?.['behavior'] === 'deny' && toolUseId) this.state.finishTool(toolUseId, 'declined');
  }

  // ── stdout ───────────────────────────────────────────────────────────────

  onOutput(msg: Obj): void {
    const type = str(msg['type']);
    switch (type) {
      case 'system':
        return this.state.system.onSystem(msg);
      case 'stream_event':
        return this.state.stream.onStreamEvent(msg);
      case 'assistant':
        return this.state.messages.onAssistant(msg);
      case 'user':
        return this.state.tools.onToolResults(msg);
      case 'result':
        return this.state.turns.onResult(msg);
      case 'rate_limit_event':
        return this.state.turns.onRateLimit(msg);
      case 'command_lifecycle':
        return this.state.system.onCommandLifecycle(msg);
      case 'control_request':
        return this.state.requests.onControlRequest(msg);
      case 'control_response':
        return;
      default:
        if (type && SILENT_TYPES.has(type)) return;
        this.state.emitUnknown(msg);
    }
  }
}
