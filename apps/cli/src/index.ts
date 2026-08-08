import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDirectiveIssue } from "./directive-create.js";
import { runDemo } from "./demo.js";
import { formatDiscoveryResult, githubDiscover } from "./github-discovery.js";
import { githubDryRun } from "./github-dry-run.js";
import type { GithubDryRunOptions } from "./github-dry-run.js";
import { getProjectContext } from "./project-context.js";
import { previewDirective } from "./preview-directive.js";
import { runFixtureWatch, runGithubWatch } from "./watch-runner.js";
import type { FixtureWatchOptions, GithubWatchOptions } from "./watch-runner.js";
import { loadProjectConfig } from "../../../packages/config/src/load.js";

export type CliCommand = "get-project-context" | "validate" | "preview-directive" | "directive" | "session" | "dry-run" | "discover" | "run" | "demo";

export const plannedCliCommands: CliCommand[] = [
  "get-project-context",
  "validate",
  "preview-directive",
  "directive",
  "session",
  "dry-run",
  "discover",
  "run",
  "demo"
];

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function readPositionalText(args: string[]): string {
  const parts: string[] = [];

  for (const arg of args) {
    if (arg.startsWith("--")) {
      break;
    }
    parts.push(arg);
  }

  return parts.join(" ");
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;

  if (command === "get-project-context") {
    const repoRoot = rest[0] ?? process.cwd();
    console.log(JSON.stringify(await getProjectContext(repoRoot), null, 2));
    return;
  }

  if (command === "validate") {
    const repoRoot = rest[0] ?? process.cwd();
    const result = await loadProjectConfig(repoRoot);
    const context = await getProjectContext(repoRoot);

    console.log(
      JSON.stringify(
        {
          valid: context.localGitTransport.valid,
          configPath: result.path,
          project: result.config.project,
          roles: result.config.roles,
          polling: result.config.polling,
          localWorkerTransport: result.config.local_worker_transport,
          githubWrites: result.config.github_writes ?? { enabled: false, allowed_actions: [] },
          localGitTransport: context.localGitTransport
        },
        null,
        2
      )
    );
    if (!context.localGitTransport.valid) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "preview-directive") {
    const [directivePath, ...approvalParts] = rest;

    if (!directivePath) {
      throw new Error("Usage: preview-directive <directive.json> <approval text>");
    }

    const result = await previewDirective(directivePath, approvalParts.join(" "));

    if (result.issueBody) {
      console.log(result.issueBody);
      return;
    }

    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }

  if (command === "directive") {
    const [subcommand, directivePath, ...approvalParts] = rest;
    const repoRoot = readOption(rest, "--repo-root") ?? process.cwd();
    const eventId = readOption(rest, "--event-id");
    const stateFilePath = readOption(rest, "--state-file");
    const dryRun = subcommand === "preview" || rest.includes("--dry-run");
    const approvalText = readPositionalText(approvalParts);

    if ((subcommand !== "preview" && subcommand !== "create") || !directivePath) {
      throw new Error("Usage: directive (preview|create) <directive.json> <approval text> [--dry-run] [--event-id <id>] [--state-file <path>]");
    }

    const result = await createDirectiveIssue({
      repoRoot,
      directivePath: path.resolve(directivePath),
      approvalText,
      dryRun,
      ...(eventId ? { eventId } : {}),
      ...(stateFilePath ? { stateFilePath: path.resolve(stateFilePath) } : {})
    });

    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "session") {
    const [subcommand] = rest;
    const repoRoot = readOption(rest, "--repo-root") ?? process.cwd();
    const stateFilePath = path.resolve(readOption(rest, "--state-file") ?? path.join(repoRoot, ".chatgpt-coordinator", "session-state.json"));

    if (subcommand === "status") {
      try {
        console.log(await readFile(stateFilePath, "utf8"));
      } catch (error) {
        if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          console.log(JSON.stringify({ consecutiveNpf: 0, status: "active" }, null, 2));
        } else {
          throw error;
        }
      }
      return;
    }

    if (subcommand === "resume") {
      const raw = await readFile(stateFilePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const resumed: Record<string, unknown> = { ...parsed, consecutiveNpf: 0, status: "active" };
      delete resumed.currentHumanGate;
      await writeFile(stateFilePath, `${JSON.stringify(resumed, null, 2)}\n`, "utf8");
      console.log(JSON.stringify(resumed, null, 2));
      return;
    }

    throw new Error("Usage: session (status|resume) [--state-file <path>]");
  }

  if (command === "dry-run") {
    const repository = readOption(rest, "--repo");
    const issue = readOption(rest, "--issue");
    const repoRoot = readOption(rest, "--repo-root") ?? process.cwd();
    const consecutiveNpf = readOption(rest, "--npf-count");

    if (!repository) {
      throw new Error("Usage: dry-run --repo <owner/repo> [--issue <number>] [--npf-count <count>]");
    }

    const options: GithubDryRunOptions = { repoRoot, repository };
    if (issue) {
      options.issueNumber = Number.parseInt(issue, 10);
    }
    if (consecutiveNpf) {
      options.consecutiveNpf = Number.parseInt(consecutiveNpf, 10);
    }

    console.log(
      JSON.stringify(
        await githubDryRun(options),
        null,
        2
      )
    );
    return;
  }

  if (command === "discover") {
    const repository = readOption(rest, "--repo");
    const repoRoot = readOption(rest, "--repo-root") ?? process.cwd();
    const stateFile = readOption(rest, "--state-file");
    const lastEventId = readOption(rest, "--last-event-id");
    const json = rest.includes("--json");

    if (!repository) {
      throw new Error("Usage: discover --repo <owner/repo> [--json] [--state-file <path>] [--last-event-id <id>] [--repo-root <path>]");
    }

    const result = await githubDiscover({
      repoRoot,
      repository,
      ...(stateFile ? { stateFilePath: path.resolve(stateFile) } : {}),
      ...(lastEventId ? { lastProcessedEventId: lastEventId } : {})
    });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    process.stdout.write(formatDiscoveryResult(result));
    return;
  }

  if (command === "demo") {
    const repoRoot = readOption(rest, "--repo-root") ?? process.cwd();
    const repository = readOption(rest, "--repo");
    const json = rest.includes("--json");
    const result = await runDemo({
      repoRoot,
      fixture: rest.includes("--fixture"),
      reset: rest.includes("--reset"),
      executeWrites: rest.includes("--execute-writes"),
      ...(repository ? { repository } : {})
    });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      for (const step of result.steps) {
        console.log(`[${step.index}/${Math.max(result.steps.length, 1)}] ${step.title} -> ${step.nextActor}`);
        console.log(`  ${step.summary}`);
      }
      for (const diagnostic of result.diagnostics) {
        console.log(`! ${diagnostic}`);
      }
      if (result.steps.length === 0) {
        console.log(result.diagnostics.join("\n") || "Demo reset complete.");
      }
    }

    if (!result.valid) {
      process.exitCode = 1;
    }
    return;
  }

  if (command === "run") {
    if (!rest.includes("--watch")) {
      throw new Error(
        "Usage: run --watch (--repo <owner/repo> [--issue <number>] | --fixture <path>) [--state-file <path>] [--max-cycles <count>] [--interval-ms <ms>] [--resume]"
      );
    }

    const fixture = readOption(rest, "--fixture");
    const repository = readOption(rest, "--repo");
    const issue = readOption(rest, "--issue");
    const repoRoot = readOption(rest, "--repo-root") ?? process.cwd();
    const maxCycles = readOption(rest, "--max-cycles");
    const intervalMs = readOption(rest, "--interval-ms");
    const npfPauseThreshold = readOption(rest, "--npf-threshold");
    const stateFile = readOption(rest, "--state-file");
    const writeStateFile = readOption(rest, "--write-state-file");
    const resume = rest.includes("--resume");
    const executeWrites = rest.includes("--execute-writes");

    if (!fixture && !repository) {
      throw new Error(
        "Usage: run --watch (--repo <owner/repo> [--issue <number>] | --fixture <path>) [--state-file <path>] [--max-cycles <count>] [--interval-ms <ms>] [--resume]"
      );
    }

    if (fixture && repository) {
      throw new Error("Choose either --repo for live GitHub watch or --fixture for fixture replay, not both");
    }

    const sharedOptions: Pick<
      FixtureWatchOptions & GithubWatchOptions,
      "maxCycles" | "intervalMs" | "npfPauseThreshold" | "stateFilePath" | "writeStateFilePath" | "resume" | "executeWrites"
    > = {};
    if (maxCycles) {
      sharedOptions.maxCycles = Number.parseInt(maxCycles, 10);
    }
    if (intervalMs) {
      sharedOptions.intervalMs = Number.parseInt(intervalMs, 10);
    }
    if (npfPauseThreshold) {
      sharedOptions.npfPauseThreshold = Number.parseInt(npfPauseThreshold, 10);
    }
    if (stateFile) {
      sharedOptions.stateFilePath = path.resolve(stateFile);
    }
    if (writeStateFile) {
      sharedOptions.writeStateFilePath = path.resolve(writeStateFile);
    }
    if (resume) {
      sharedOptions.resume = true;
    }
    if (executeWrites) {
      sharedOptions.executeWrites = true;
    }

    if (fixture) {
      const options: FixtureWatchOptions = { repoRoot, fixturePath: path.resolve(fixture), ...sharedOptions };

      console.log(JSON.stringify(await runFixtureWatch(options), null, 2));
      return;
    }

    const options: GithubWatchOptions = { repoRoot, repository: repository as string, ...sharedOptions };
    if (issue) {
      options.issueNumber = Number.parseInt(issue, 10);
    }

    console.log(JSON.stringify(await runGithubWatch(options), null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command ?? "(none)"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
