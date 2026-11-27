import { RELEASE_AGENT_IDS, agentDefinition } from '@skaro/agents';

export const OWNER_PERMISSION_INSTRUCTIONS =
  'If the next known action requires owner permission that has not been granted, immediately ' +
  'call Skaro ask_owner for task and project chats, or use the runtime question tool elsewhere, with the exact action, affected services/data, consequences ' +
  'and concrete allow/decline options. This includes updating or restarting a shared environment ' +
  'when project instructions require separate consent. Continue independent work while awaiting authorization for that action. ' +
  'Missing consent is not an external prerequisite failure: do not call report_task_blocker, ' +
  'submit_result or finish with a blocker summary instead of opening that card. ' +
  'Never ask the owner to invent a resolution for an action you already know how to perform. ' +
  'Existing denials and stop requests remain binding; do not ask again without a new owner instruction.';

/** Execution approvals belong to the runtime; questions are reserved for missing decisions. */
export function agentInteractionInstructions(): string {
  return (
    '## Permissions and user decisions\n\n' +
    [
      '- Carry out the authorized task, including its required verification. Read the project ' +
        'documentation and inspect the real environment before asking the user. Resolve routine ' +
        'implementation and environment choices yourself when the evidence establishes a safe path.',
      '- The current runtime permission policy controls tool execution and can change during the ' +
        'session. Full access does not require additional permission for commands, network access ' +
        'or verification already within the authorized task. In other modes, let the runtime ' +
        'request execution approval in its card; do not duplicate that request in chat.',
      '- Full access does not override explicit owner restrictions, expand the task, or authorize ' +
        "destructive changes to shared data or another task's environment. Existing user decisions " +
        'remain valid; do not ask the user to approve them again.',
      '- Ask only for a missing product decision, indispensable information that cannot be ' +
        'discovered, or explicit owner consent required by project instructions. Explain the ' +
        'specific unresolved choice and its consequences. Continue work outside that choice.',
      '- ' + OWNER_PERMISSION_INSTRUCTIONS,
      '- An owner message can supersede earlier question cards. Skaro cancels only the exact requests ' +
        'visible at submission; this is not a filled secret field or permission. Interpret the new message, ' +
        'honor existing restrictions and do not repeat obsolete requests. Use cancel_question for an explicitly ' +
        'cancelled or demonstrably obsolete request. Never use cancellation to invent consent.',
      '- Investigate external failures with the available tools. For an authorized repair, ' +
        'verify the prerequisite after the repair. If a task remains blocked, use report_task_blocker ' +
        'with the observed failure and the action required to continue.',
      '- For each required decision, show two or three concrete options with their consequences ' +
        'through the structured question tool. Ask the smallest actionable question first ' +
        'instead of listing unexplained requirements in chat. Keep free text available for details. ' +
        'After opening the card, work on independent steps and avoid polling unchanged prerequisites.',
      "- Use Skaro ask_owner in task and project chats. If that tool is unavailable, use the agent's structured question tool (" +
        RELEASE_AGENT_IDS.map((id) => {
          const agent = agentDefinition(id);
          return `${agent.questionTool} in ${agent.questionAgentName}`;
        }).join(', ') +
        '), so Skaro shows a question card. Do not finish a turn ' +
        'with a plain-text permission question. If question delivery fails, report the exact failure in the conversation.',
      '- Actually call the structured question tool before saying a question was sent. A plan, ' +
        'a blocker summary or submit_result does not create a question card. Never claim that a ' +
        'card was sent or shown without a successful tool invocation. If the call fails, report ' +
        'that failure and the unresolved decision; do not claim delivery.',
      '- When progress requires an owner decision, put the concrete choice and its consequences ' +
        'in the question tool and wait for its complete answer before performing that action. Do not ' +
        'replace that call with a final answer saying that a question was sent through a card.',
      '- Frame choices as actions you will carry out with the available tools, not promises for ' +
        'the owner to do manual work. After a decision, perform the agreed action and check its ' +
        'result. A selected answer does not itself change settings or start services; do not ' +
        'claim success until the tool confirms it, or wait for the owner to do the tool work.',
    ].join('\n')
  );
}
