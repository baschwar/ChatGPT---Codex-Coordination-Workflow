import { readFile } from "node:fs/promises";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";
import YAML from "yaml";
import type { ProjectCoordinatorConfig } from "./config.js";

export interface ConfigLoadResult {
  config: ProjectCoordinatorConfig;
  path: string;
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
  const schema = JSON.parse(await readFile(path.join(repoRoot, "packages", "schemas", "project-config.schema.json"), "utf8")) as object;

  return {
    config: validateProjectConfig(parsed, schema),
    path: configPath
  };
}
