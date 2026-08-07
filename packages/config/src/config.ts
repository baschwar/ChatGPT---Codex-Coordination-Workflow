export interface ProjectCoordinatorConfig {
  version: 1;
  project: {
    name: string;
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
  approval_gates: Record<string, "explicit" | "disabled">;
}
