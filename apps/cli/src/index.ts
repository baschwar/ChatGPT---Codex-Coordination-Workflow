import { fileURLToPath } from "node:url";
import path from "node:path";
import { githubDryRun } from "./github-dry-run.js";
import type { GithubDryRunOptions } from "./github-dry-run.js";
import { getProjectContext } from "./project-context.js";
import { previewDirective } from "./preview-directive.js";
import { runFixtureWatch } from "./watch-runner.js";
import type { WatchOptions } from "./watch-runner.js";

export type CliCommand = "get-project-context" | "preview-directive" | "dry-run" | "run";

export const plannedCliCommands: CliCommand[] = [
  "get-project-context",
  "preview-directive",
  "dry-run",
  "run"
];

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;

  if (command === "get-project-context") {
    const repoRoot = rest[0] ?? process.cwd();
    console.log(JSON.stringify(await getProjectContext(repoRoot), null, 2));
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

  if (command === "run") {
    if (!rest.includes("--watch")) {
      throw new Error("Usage: run --watch --fixture <path> [--max-cycles <count>] [--interval-ms <ms>]");
    }

    const fixture = readOption(rest, "--fixture");
    const repoRoot = readOption(rest, "--repo-root") ?? process.cwd();
    const maxCycles = readOption(rest, "--max-cycles");
    const intervalMs = readOption(rest, "--interval-ms");
    const npfPauseThreshold = readOption(rest, "--npf-threshold");

    if (!fixture) {
      throw new Error("Usage: run --watch --fixture <path> [--max-cycles <count>] [--interval-ms <ms>]");
    }

    const options: WatchOptions = { repoRoot, fixturePath: path.resolve(fixture) };
    if (maxCycles) {
      options.maxCycles = Number.parseInt(maxCycles, 10);
    }
    if (intervalMs) {
      options.intervalMs = Number.parseInt(intervalMs, 10);
    }
    if (npfPauseThreshold) {
      options.npfPauseThreshold = Number.parseInt(npfPauseThreshold, 10);
    }

    console.log(
      JSON.stringify(
        await runFixtureWatch(options),
        null,
        2
      )
    );
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
