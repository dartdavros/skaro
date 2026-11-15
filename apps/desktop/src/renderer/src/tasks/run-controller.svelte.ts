import type { AgentSettings } from '../../../shared/ipc';
import type { RunProps } from './run-props';
import { runSettings } from './run-settings';

export function createRunController(p: RunProps) {
  let settings = $state<AgentSettings>();
  let sandboxHolds = $state<boolean>();

  $effect(() => {
    const projectId = p.projectId;
    const taskId = p.tasks[0]?.id;
    if (!taskId) return;
    let cancelled = false;
    void Promise.all([
      window.skaro.invoke('project.settings', projectId),
      window.skaro.invoke('task.open', projectId, taskId, { paged: true }),
    ])
      .then(([project, view]) => {
        if (cancelled) return;
        settings = runSettings(project, view.settings, !!view.run);
        sandboxHolds = view.sandboxHolds;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error(error);
        p.onclose();
      });
    return () => {
      cancelled = true;
    };
  });

  async function confirm(next: AgentSettings): Promise<void> {
    for (const task of p.tasks)
      await window.skaro.invoke('task.setSettings', p.projectId, task.id, next);
    await p.onconfirm();
  }

  return {
    get settings() {
      return settings;
    },
    get sandboxHolds() {
      return sandboxHolds;
    },
    confirm,
  };
}

export type RunController = ReturnType<typeof createRunController>;
