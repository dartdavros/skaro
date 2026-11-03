/** Host-bound scope shared with existing MCP handlers; callers cannot widen it. */
export interface SkaroScope {
  kind: 'task' | 'project_chat' | 'integration';
  integrationId?: string;
  projectId: string;
  taskId?: string;
  runId?: string;
  chatId?: string;
  importId?: string;
}
