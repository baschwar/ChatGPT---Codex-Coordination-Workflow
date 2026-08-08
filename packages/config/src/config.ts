export interface ProjectCoordinatorConfig {
  version: 1;
  project: {
    name: string;
    repo?: string;
  };
  roles: {
    thinker: string;
    worker: string;
  };
  governance: {
    files: string[];
  };
  labels: {
    implementation_ready: string;
    implementation_in_progress: string;
    manual_validation: string;
    review_ready: string;
    blocked: string;
    needs_human: string;
  };
  polling: {
    interval_minutes: number;
    inactivity_timeout_minutes: number;
  };
  local_worker_transport: {
    git_protocol: "ssh";
    https_fallback: "disabled";
  };
  github_writes?: {
    enabled: boolean;
    allowed_actions: Array<
      | "CREATE_ISSUE"
      | "ADD_LABEL"
      | "REMOVE_LABEL"
      | "POST_HANDOFF_COMMENT"
      | "MARK_REVIEW_READY"
      | "UPDATE_ISSUE_STATE"
    >;
  };
  approval_gates: Record<string, "explicit" | "disabled">;
}
