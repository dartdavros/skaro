import { randomUUID } from 'node:crypto';
import { validateQuestionAnswer } from '@skaro/timeline';
import type { RuntimeAction, RuntimeFact, RuntimeState } from './model.ts';

/** Pure decisions; the journal commits every decision before it can become observable. */
export function commandFacts(
  state: RuntimeState,
  action: RuntimeAction,
): { facts: RuntimeFact[]; error?: string } {
  const config = state.config;
  if (!config) throw new Error('Runtime not initialized');
  if (state.closed && !['send', 'steer', 'close', 'interrupt'].includes(action.type))
    throw new Error('Session was closed; explicit input is required to resume');
  const blocked = Object.values(state.effects).some((effect) => effect.state !== 'completed');
  const questions = Object.values(state.interactions);
  const boundary = () => {
    if (blocked || questions.length)
      throw new Error('An effect or interaction prevents this context change');
  };
  switch (action.type) {
    case 'send':
    case 'steer': {
      if (
        questions.length ||
        Object.values(state.effects).some((effect) => effect.state === 'pending')
      )
        throw new Error('An effect or interaction prevents this context change');
      if (!action.input.text.trim() && !action.input.images?.length)
        throw new Error('Input is empty');
      if (action.input.images?.length)
        throw new Error('Image input requires a verified model connector');
      const id = randomUUID();
      const turnId = randomUUID();
      const timestamp = Date.now();
      const error = 'Model connectors are not implemented (BA-4); no model request was sent';
      return {
        error,
        facts: [
          { type: 'input', id, turnId, input: action.input, timestamp },
          { type: 'timeline', event: { t: 'turn.started', turnId } },
          {
            type: 'timeline',
            event: {
              t: 'item.upsert',
              item: {
                id,
                turnId,
                startedAt: timestamp,
                status: 'done',
                kind: 'message',
                role: 'user',
                text: action.input.text,
                native: { agent: 'skaro', type: 'input', ref: id },
              },
            },
          },
          {
            type: 'timeline',
            event: {
              t: 'turn.completed',
              turnId,
              outcome: 'failed',
              error: { category: 'other', message: error },
            },
          },
        ],
      };
    }
    case 'respond': {
      const interaction = state.interactions[action.interactionId];
      if (!interaction) throw new Error('Interaction is not open');
      if (
        interaction.kind === 'question' &&
        interaction.questions.some((question) => question.secret)
      )
        throw new Error('Secret answers require the protected credential/input transport');
      if (interaction.kind !== action.answer.kind)
        throw new Error('Interaction answer kind mismatch');
      if (
        interaction.kind === 'approval' &&
        action.answer.kind === 'approval' &&
        !interaction.choices.includes(action.answer.choice)
      )
        throw new Error('Approval choice is not available');
      validateQuestionAnswer(interaction, action.answer);
      return {
        facts: [
          { type: 'answer', interactionId: interaction.id, answer: action.answer },
          {
            type: 'timeline',
            event: { t: 'interaction.closed', id: interaction.id, resolution: 'answered' },
          },
        ],
      };
    }
    case 'setModel': {
      boundary();
      if (action.effort !== undefined)
        throw new Error('Effort requires a verified connector parameter schema');
      const matches =
        config.availableRoutes?.filter((route) => route.routeId === action.model) ?? [];
      if (matches.length !== 1) throw new Error('Unknown or ambiguous configured route selection');
      return { facts: [{ type: 'route', route: matches[0]! }] };
    }
    case 'setRoute':
      boundary();
      return { facts: [{ type: 'route', route: action.route }] };
    case 'setPermissionMode':
      boundary();
      if (!['ask', 'auto', 'full'].includes(action.mode))
        throw new Error('Unknown permission mode');
      return { facts: [{ type: 'permissions', mode: action.mode }] };
    case 'rewind':
      boundary();
      if (!state.inputs.some((input) => input.id === action.toItemId))
        throw new Error('Unknown rewind input');
      return {
        facts: [
          { type: 'rewind', toItemId: action.toItemId },
          { type: 'timeline', event: { t: 'rewound', toItemId: action.toItemId } },
        ],
      };
    case 'compact':
      throw new Error('Compaction requires the context/connector modules (BA-4/BA-5)');
    case 'stopBackground':
      throw new Error('Background process tools are not implemented (BA-3)');
    case 'interrupt':
      return { facts: [{ type: 'stopped' }] };
    case 'close':
      return { facts: [{ type: 'closed' }] };
    default:
      throw new Error('Unknown runtime command');
  }
}
