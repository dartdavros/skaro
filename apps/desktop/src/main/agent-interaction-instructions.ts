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
        'specific unresolved choice and its consequences; continue independent work meanwhile.',
      "- Use the agent's structured question tool for those decisions (request_user_input or request_user_input_async in " +
        'Codex, AskUserQuestion in Claude), so Skaro shows a question card. Do not finish a turn ' +
        'with a plain-text permission question. If that tool is unavailable, report the precise ' +
        'blocker rather than pretending a card was shown or repeatedly asking in chat.',
      '- Actually call the structured question tool before saying a question was sent. A plan, ' +
        'a blocker summary or submit_result does not create a question card. Never claim that a ' +
        'card was sent or shown without a successful tool invocation. If the call fails, report ' +
        'that failure and the unresolved decision; do not claim delivery.',
      '- When progress requires an owner decision, put the concrete choice and its consequences ' +
        'in the question tool and wait for its answer before completing dependent work. Do not ' +
        'replace that call with a final answer saying that a question was sent through a card.',
    ].join('\n')
  );
}
