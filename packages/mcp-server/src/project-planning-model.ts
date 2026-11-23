import type { ProposedTaskArgs } from './project-tool-model.ts';
import type { SkaroScope } from './tools.ts';
import type { ToolResult } from './server.ts';

export interface SavedPlanTask extends ProposedTaskArgs {
  requirements: string[];
}

export interface PreparePlanArgs {
  key: string;
  title: string;
  expectedTotal: number;
  milestones: {
    milestone: string;
    requirements: string[];
    tasks: SavedPlanTask[];
  }[];
}

export interface PlanKeyArgs {
  key: string;
}
export interface RevisePlanArgs extends PreparePlanArgs {
  reason: string;
}

export interface ProposeSavedPlanArgs extends PlanKeyArgs {
  milestone?: string;
}

export interface ControlPlanArgs extends PlanKeyArgs {
  action: 'pause' | 'resume' | 'cancel';
  reason: string;
}

export interface ProjectPlanningHandlers {
  beginTaskPlan?(decisionId: string | undefined, scope: SkaroScope): Promise<ToolResult>;
  revisePlan?(args: RevisePlanArgs, scope: SkaroScope): Promise<ToolResult>;
  preparePlan(args: PreparePlanArgs, scope: SkaroScope): Promise<ToolResult>;
  proposeSavedPlan(args: ProposeSavedPlanArgs, scope: SkaroScope): Promise<ToolResult>;
  finishPlan(args: PlanKeyArgs, scope: SkaroScope): Promise<ToolResult>;
  controlPlan(args: ControlPlanArgs, scope: SkaroScope): Promise<ToolResult>;
}
