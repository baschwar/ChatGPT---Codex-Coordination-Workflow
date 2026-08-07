import { fileURLToPath } from "node:url";
import { getProjectContext } from "./project-context.js";
import { previewDirective } from "./preview-directive.js";

export type CliCommand = "get-project-context" | "preview-directive";

export const plannedCliCommands: CliCommand[] = [
  "get-project-context",
  "preview-directive"
];

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

  throw new Error(`Unknown command: ${command ?? "(none)"}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
