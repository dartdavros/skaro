import type { DecisionOrigin } from '../../../shared/project-decisions';
export const decisionNavigation = $state<{ origin?: DecisionOrigin; importId?: string }>({});
export function watchDecisionImport(
  projectId: string,
  chatId: string | undefined,
  show: (id: string) => void,
) {
  $effect(() => {
    const origin = decisionNavigation.origin;
    if (
      origin?.projectId === projectId &&
      origin.kind === 'chat' &&
      origin.id === chatId &&
      decisionNavigation.importId
    ) {
      show(decisionNavigation.importId);
      decisionNavigation.importId = undefined;
    }
  });
}
