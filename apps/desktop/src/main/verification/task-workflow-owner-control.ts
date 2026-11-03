import type { Interaction } from '@skaro/timeline';
import type { Services } from '../app-services';

/** Relay an explicit owner answer to this exact live approval; never manufacture approval. */
export async function awaitWorkflowApproval(
  services: Services,
  projectId: string,
  runId: string,
  interaction: Interaction,
) {
  if (interaction.kind !== 'approval') return false;
  return new Promise<boolean>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      process.off('message', receive);
    };
    const timer = setTimeout(() => {
      finish();
      resolve(false);
    }, 600000);
    const receive = (raw: unknown) => {
      const message = raw as {
        type?: string;
        runId?: string;
        interactionId?: string;
        choice?: string;
      };
      if (
        message?.type !== 'workflow-owner-answer' ||
        message.runId !== runId ||
        message.interactionId !== interaction.id ||
        !['allow_once', 'deny'].includes(message.choice ?? '') ||
        Object.keys(message).sort().join(',') !== 'choice,interactionId,runId,type'
      )
        return;
      finish();
      void services.runs
        .respond(projectId, 'T-006', `${runId}:${interaction.id}`, {
          kind: 'approval',
          choice: message.choice as 'allow_once' | 'deny',
        })
        .then(() => {
          process.send?.({
            type: 'workflow-owner-answer-recorded',
            runId,
            interactionId: interaction.id,
          });
          resolve(true);
        }, reject);
    };
    process.on('message', receive);
    process.send?.({ type: 'workflow-approval', runId, interaction });
  });
}
