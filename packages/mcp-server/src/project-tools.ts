// Tools of the project chat (architecture.md 6, agent-output.md 5.4): read the project, propose
// documents, ADRs, milestones and tasks. Proposals never hold the turn: the tool answers at once
// and the user decides in a card.

import type { Tool } from './server.ts';
import type { SkaroScope } from './tools.ts';
import type { ProjectToolHandlers } from './project-tool-model.ts';
import { documentTools } from './project-document-tools.ts';
import { planTools, updateTaskTool } from './project-plan-tools.ts';
import { importTools } from './project-import-tools.ts';
import { planningTools } from './project-planning-tools.ts';
import { replanTasksTool } from './task-replan-tool.ts';
import { deleteTasksTool } from './task-delete-tool.ts';
export type * from './project-tool-model.ts';
export { ToolArgsError } from './project-tool-args.ts';

export function projectTools(handlers: ProjectToolHandlers): Tool<SkaroScope>[] {
  return [
    {
      name: 'get_project_context',
      description:
        'Read the project as Skaro keeps it: brief, architecture, ADRs, specifications, ' +
        'milestones and tasks with ' +
        'statuses and dependencies. Call it before proposing documents, milestones or tasks.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      call: (_args, scope) => handlers.context(scope),
    },
    ...documentTools(handlers),
    ...planTools(handlers),
    ...(handlers.replanTasks
      ? [
          replanTasksTool((args, scope) => handlers.replanTasks!(args, scope)),
          deleteTasksTool((args, scope) => handlers.replanTasks!(args, scope)),
        ]
      : []),
    ...(handlers.planning ? planningTools(handlers.planning) : []),
    ...importTools(handlers),
    updateTaskTool(handlers),
  ];
}
