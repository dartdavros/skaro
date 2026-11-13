import { coordinationHash } from './project-coordinator-request';

/** Adapter request counters restart; native decisions belong to a particular owner and turn. */
export function decisionItemId(
  owner: string,
  turn: string | undefined,
  interaction: string,
): string {
  if (interaction.startsWith('skaro-wait-') || interaction.startsWith('coordinator:'))
    return `skaro-decision-${interaction}`;
  return `skaro-decision-${coordinationHash([owner, turn, interaction])}`;
}
