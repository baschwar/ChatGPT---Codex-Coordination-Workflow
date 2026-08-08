import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { loadProjectConfig } from "../../../packages/config/src/load.js";

const execFileAsync = promisify(execFile);

export interface GovernanceFileStatus {
  path: string;
  exists: boolean;
  bytes?: number;
}

export type LocalGitTransportBlocker = "GIT_REMOTE_REQUIRED" | "GIT_SSH_REMOTE_REQUIRED";

export interface LocalGitTransportStatus {
  requiredProtocol: "ssh";
  httpsFallback: "disabled";
  originUrl?: string;
  valid: boolean;
  blocker?: LocalGitTransportBlocker;
  diagnostics: string[];
}

export interface ProjectContext {
  configPath: string;
  projectName: string;
  projectRepo?: string;
  labels: Record<string, string>;
  approvalGates: Record<string, string>;
  localGitTransport: LocalGitTransportStatus;
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

function isSshGitRemote(url: string): boolean {
  return /^git@github\.com:[^/]+\/[^/]+\.git$/.test(url) || /^ssh:\/\/git@github\.com\/[^/]+\/[^/]+\.git$/.test(url);
}

function isHttpsGitHubRemote(url: string): boolean {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/.test(url);
}

async function inspectLocalGitTransport(repoRoot: string): Promise<LocalGitTransportStatus> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: repoRoot });
    const originUrl = stdout.trim();

    if (isSshGitRemote(originUrl)) {
      return {
        requiredProtocol: "ssh",
        httpsFallback: "disabled",
        originUrl,
        valid: true,
        diagnostics: []
      };
    }

    if (isHttpsGitHubRemote(originUrl)) {
      return {
        requiredProtocol: "ssh",
        httpsFallback: "disabled",
        originUrl,
        valid: false,
        blocker: "GIT_SSH_REMOTE_REQUIRED",
        diagnostics: ["origin must use an SSH GitHub remote; HTTPS fallback is disabled for local worker Git transport."]
      };
    }

    return {
      requiredProtocol: "ssh",
      httpsFallback: "disabled",
      originUrl,
      valid: false,
      blocker: "GIT_SSH_REMOTE_REQUIRED",
      diagnostics: ["origin must use git@github.com:owner/repo.git or ssh://git@github.com/owner/repo.git."]
    };
  } catch {
    return {
      requiredProtocol: "ssh",
      httpsFallback: "disabled",
      valid: false,
      blocker: "GIT_REMOTE_REQUIRED",
      diagnostics: ["origin remote is required and must use SSH."]
    };
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

  const context: ProjectContext = {
    configPath,
    projectName: config.project.name,
    labels: config.labels,
    approvalGates: config.approval_gates,
    localGitTransport: await inspectLocalGitTransport(repoRoot),
    governanceFiles
  };

  if (config.project.repo) {
    context.projectRepo = config.project.repo;
  }

  return context;
}
