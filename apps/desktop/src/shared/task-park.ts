export interface TaskParkReceipt {
  requestId: string;
  status: 'paused' | 'stopped';
  revision: number;
}
export interface TaskControlMethods {
  'task.controls': (
    projectId: string,
    taskId: string,
  ) => import('./ipc-sessions').TaskDetail | undefined;
  'task.park': (
    projectId: string,
    taskId: string,
    status: TaskParkReceipt['status'],
    requestId?: string,
  ) => TaskParkReceipt;
}
