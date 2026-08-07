import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectConfig } from "../../../packages/config/src/load.js";

export interface GovernanceFileStatus {
  path: string;
  exists: boolean;
  bytes?: number;
}

export interface ProjectContext {
  configPath: string;
  projectName: string;
  labels: Record<string, string>;
  approvalGates: Record<string, string>;
  governanceFiles: GovernanceFileStatus[];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function getProjectContext(repoRoot: string): Promise<ProjectContext> {
  const { config, path: configPath } = await loadProjectConfig(repoRoot);
  const governanceFiles: GovernanceFileStatus[] = [];

  for (const governanceFile of config.governance.files) {
    const absolutePath = path.join(repoRoot, governanceFile);
    const exists = await fileExists(absolutePath);
    const status: GovernanceFileStatus = { path: governanceFile, exists };

    if (exists) {
      status.bytes = Buffer.byteLength(await readFile(absolutePath, "utf8"));
    }

    governanceFiles.push(status);
  }

  return {
    configPath,
    projectName: config.project.name,
    labels: config.labels,
    approvalGates: config.approval_gates,
    governanceFiles
  };
}

