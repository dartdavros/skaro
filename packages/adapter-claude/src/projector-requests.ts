import { arr, formFields, obj, str, type Interaction, type Obj } from '@skaro/timeline';
import { questionsOf, hostOf } from './projector-helpers.ts';
import type { ClaudeProjectionState } from './projector-state.ts';

export class ClaudeRequestsProjection {
  private readonly state: ClaudeProjectionState;
  constructor(state: ClaudeProjectionState) {
    this.state = state;
  }
  onControlRequest(msg: Obj): void {
    const requestId = str(msg['request_id']);
    const request = obj(msg['request']);
    if (!requestId || !request) return;
    if (request['subtype'] === 'elicitation') return this.onElicitation(requestId, request);
    if (request['subtype'] !== 'can_use_tool') return;
    const toolName = str(request['tool_name']) ?? '';
    const input = obj(request['input']) ?? {};
    const toolUseId = str(request['tool_use_id']);
    const id = `perm-${requestId}`;

    let interaction: Interaction;
    if (toolName === 'AskUserQuestion') {
      interaction = { kind: 'question', id, questions: questionsOf(input) };
    } else if (toolName === 'ExitPlanMode') {
      interaction = { kind: 'plan_approval', id, plan: str(input['plan']) ?? '' };
    } else {
      const command = str(input['command']);
      const path =
        str(input['file_path']) ?? str(input['notebook_path']) ?? str(request['blocked_path']);
      const type = command
        ? 'command'
        : ['Edit', 'Write', 'NotebookEdit'].includes(toolName)
          ? 'file_write'
          : toolName.startsWith('mcp__')
            ? 'mcp'
            : toolName === 'WebFetch'
              ? 'network'
              : 'other';
      interaction = {
        kind: 'approval',
        id,
        itemId: toolUseId,
        action: {
          type,
          title: str(request['title']) ?? toolName,
          command,
          paths: path ? [path] : undefined,
          host: toolName === 'WebFetch' ? hostOf(str(input['url'])) : undefined,
          reason: str(request['decision_reason']) ?? str(request['description']),
        },
        choices: arr(request['permission_suggestions']).length
          ? ['allow_once', 'allow_session', 'deny']
          : ['allow_once', 'deny'],
      };
    }
    this.state.openRequests.set(requestId, interaction);
    if (toolUseId) this.state.toolUseInteractions.set(toolUseId, interaction.id);
    this.state.emit({ t: 'interaction.opened', interaction });
  }

  /** MCP server asks for input (form) or a browser sign-in (url). */
  onElicitation(requestId: string, request: Obj): void {
    const server = str(request['mcp_server_name']) ?? 'mcp';
    const id = `elicit-${requestId}`;
    const url = str(request['url']);
    const interaction: Interaction =
      request['mode'] === 'url' && url
        ? { kind: 'login', id, server, url }
        : {
            kind: 'form',
            id,
            server,
            title: str(request['title']) ?? str(request['message']) ?? server,
            fields: formFields(request['requested_schema']),
          };
    this.state.openRequests.set(requestId, interaction);
    this.state.emit({ t: 'interaction.opened', interaction });
  }
}
