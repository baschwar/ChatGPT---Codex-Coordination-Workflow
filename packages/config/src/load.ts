import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import YAML from "yaml";
import type { ProjectCoordinatorConfig } from "./config.js";

const schemaFileName = "project-config.schema.json";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface ConfigLoadResult {
  config: ProjectCoordinatorConfig;
  path: string;
}

async function loadProjectConfigSchema(): Promise<object> {
  const candidatePaths = [
    path.resolve(moduleDir, "..", "..", "schemas", schemaFileName),
    path.resolve(moduleDir, "..", "..", "..", "schemas", schemaFileName),
    path.resolve(moduleDir, "..", "..", "..", "..", "packages", "schemas", schemaFileName)
  ];
  const failures: string[] = [];

  for (const candidatePath of candidatePaths) {
    try {
      return JSON.parse(await readFile(candidatePath, "utf8")) as object;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${candidatePath}: ${message}`);
    }
  }

  throw new Error(`Unable to load coordinator config schema from runtime package: ${failures.join("; ")}`);
}

export function validateProjectConfig(parsed: unknown, schema: object): ProjectCoordinatorConfig {
  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(schema);

  if (!validate(parsed)) {
    const message = validate.errors?.map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    throw new Error(`Invalid coordinator config: ${message}`);
  }

  return parsed as ProjectCoordinatorConfig;
}

export async function loadProjectConfig(repoRoot: string): Promise<ConfigLoadResult> {
  const configPath = path.join(repoRoot, ".github", "chatgpt-coordinator.yml");
  const raw = await readFile(configPath, "utf8");
  const parsed = YAML.parse(raw) as unknown;
  const schema = await loadProjectConfigSchema();

  return {
    config: validateProjectConfig(parsed, schema),
    path: configPath
  };
}
