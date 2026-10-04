import { arr, bool, formFields, obj, str, type Interaction, type Obj } from '@skaro/timeline';
import type { CodexProjectionState } from './projector-state.ts';

export class CodexRequests {
  private readonly state: CodexProjectionState;
  constructor(state: CodexProjectionState) {
    this.state = state;
  }
  onServerRequest(id: string, method: string, p: Obj): void {
    const interactionId = `req-${id}`;
    let interaction: Interaction | undefined;
    switch (method) {
      case 'item/commandExecution/requestApproval':
        interaction = {
          kind: 'approval',
          id: interactionId,
          itemId: str(p['itemId']),
          action: {
            type: obj(p['networkApprovalContext']) ? 'network' : 'command',
            title: str(p['command']) ?? 'command',
            command: str(p['command']),
            host: str(obj(p['networkApprovalContext'])?.['host']),
            reason: str(p['reason']),
          },
          choices: ['allow_once', 'allow_session', 'deny'],
        };
        break;
      case 'item/fileChange/requestApproval': {
        const item = this.state.items.get(str(p['itemId']) ?? '');
        interaction = {
          kind: 'approval',
          id: interactionId,
          itemId: str(p['itemId']),
          action: {
            type: 'file_write',
            title: 'file change',
            paths: item?.kind === 'file_change' ? item.files.map((f) => f.path) : undefined,
            reason: str(p['reason']),
          },
          choices: ['allow_once', 'allow_session', 'deny'],
        };
        break;
      }
      case 'item/permissions/requestApproval':
        interaction = {
          kind: 'approval',
          id: interactionId,
          itemId: str(p['itemId']),
          action: { type: 'other', title: 'permissions', reason: str(p['reason']) },
          choices: ['allow_once', 'allow_session', 'deny'],
        };
        break;
      case 'item/tool/requestUserInput':
        interaction = {
          kind: 'question',
          id: interactionId,
          questions: arr(p['questions']).map((q, index) => {
            const question = obj(q) ?? {};
            return {
              id: str(question['id']) ?? String(index),
              header: str(question['header']) ?? '',
              text: str(question['question']) ?? '',
              multi: false,
              allowFreeText: bool(question['isOther']) ?? false,
              secret: bool(question['isSecret']) ?? false,
              options: arr(question['options']).map((o) => ({
                label: str(obj(o)?.['label']) ?? '',
                description: str(obj(o)?.['description']),
              })),
            };
          }),
        };
        break;
      case 'mcpServer/elicitation/request': {
        const server = str(p['serverName']) ?? 'mcp';
        const url = str(p['url']);
        interaction =
          p['mode'] === 'url' && url
            ? { kind: 'login', id: interactionId, server, url }
            : {
                kind: 'form',
                id: interactionId,
                server,
                title: str(p['message']) ?? server,
                fields: formFields(p['requestedSchema']),
              };
        break;
      }
      default:
        this.state.emitUnknown({ method, params: p, id });
        return;
    }
    this.state.openRequests.set(id, interaction);
    this.state.emit({ t: 'interaction.opened', interaction });
  }

  closeInteraction(requestId: string): void {
    const interaction = this.state.openRequests.get(requestId);
    if (!interaction) return;
    this.state.openRequests.delete(requestId);
    this.state.emit({ t: 'interaction.closed', id: interaction.id, resolution: 'answered' });
  }
}
