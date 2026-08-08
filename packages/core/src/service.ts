export type ServiceSupervisor = "launchd" | "systemd" | "windows-task-scheduler";

export interface WatchCommandSpec {
  repoRoot: string;
  repository: string;
  stateFile: string;
  intervalMinutes: number;
  resume?: boolean;
}

export interface ServiceCommand {
  supervisor: ServiceSupervisor;
  command: string[];
  diagnostics: string[];
}

export function buildWatchCommand(spec: WatchCommandSpec): string[] {
  const command = [
    "npm",
    "run",
    "coordinator",
    "--",
    "run",
    "--watch",
    "--repo",
    spec.repository,
    "--state-file",
    spec.stateFile,
    "--interval-ms",
    String(spec.intervalMinutes * 60 * 1000)
  ];

  if (spec.resume) {
    command.push("--resume");
  }

  return command;
}

export function buildServiceCommand(supervisor: ServiceSupervisor, spec: WatchCommandSpec): ServiceCommand {
  const diagnostics =
    supervisor === "launchd"
      ? []
      : [`${supervisor} is a future adapter boundary; Beta 2 only documents macOS launchd wiring.`];

  return {
    supervisor,
    command: buildWatchCommand(spec),
    diagnostics
  };
}
