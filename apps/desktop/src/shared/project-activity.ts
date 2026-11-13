import type { BackgroundJob } from './background';
export interface ProjectActivityPage {
  jobs: BackgroundJob[];
  nextCursor?: number;
}
export interface ProjectActivityMethods {
  'activity.page': (projectId: string, cursor?: number) => ProjectActivityPage;
}
