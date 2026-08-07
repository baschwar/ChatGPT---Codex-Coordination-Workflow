export const plannedMcpTools = [
  "get_project_context",
  "list_ready_tasks",
  "create_approved_directive",
  "get_task_progress",
  "list_review_ready_tasks",
  "review_task",
  "post_task_comment",
  "record_human_approval"
] as const;

export type PlannedMcpTool = (typeof plannedMcpTools)[number];

