import { spawn } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  isSafeReleaseSourcePath,
  parseReleaseArguments,
  releaseEnvironment,
  releaseSteps,
  type ReleaseOptions,
  type ReleaseStep,
} from "../lib/release/verification.ts";

type StepResult = {
  name: string;
  status: "passed" | "failed";
  duration_ms: number;
  log: string;
};

type ReleaseReport = {
  status: "passed" | "failed";
  database_included: boolean;
  workspace_retained: boolean;
  started_at: string;
  completed_at: string;
  steps: StepResult[];
};

type ArtifactPaths = {
  artifactDirectory: string;
  buildWorkspace: string;
  logDirectory: string;
  npmCache: string;
  qualityWorkspace: string;
};

type GateResult = {
  status: ReleaseReport["status"];
  steps: StepResult[];
};

const repositoryRoot = resolve(process.cwd());

async function capture(command: string, args: string[]): Promise<Buffer> {
  return await new Promise<Buffer>((resolveCapture, rejectCapture) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: releaseEnvironment(process.env, "", ""),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    let errors = "";
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString("utf8");
    });
    child.on("error", rejectCapture);
    child.on("close", (code) => {
      if (code === 0) resolveCapture(Buffer.concat(output));
      else
        rejectCapture(new Error(errors.trim() || "release_inventory_failed"));
    });
  });
}

async function copyReleaseSources(workspace: string): Promise<void> {
  const inventory = await capture("git", [
    "ls-files",
    "-co",
    "--exclude-standard",
    "-z",
  ]);
  const paths = inventory
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
  if (!paths.length) throw new Error("release_inventory_empty");
  for (const path of paths) {
    if (!isSafeReleaseSourcePath(path))
      throw new Error(`unsafe_release_source:${path}`);
    const source = join(repositoryRoot, path);
    const metadata = await lstat(source);
    if (!metadata.isFile())
      throw new Error(`unsupported_release_source:${path}`);
    const destination = join(workspace, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
}

async function prepareWorkspace(workspace: string): Promise<void> {
  await mkdir(workspace);
  await copyReleaseSources(workspace);
  await symlink(
    join(repositoryRoot, "node_modules"),
    join(workspace, "node_modules"),
  );
}

async function tail(path: string, lines = 30): Promise<string> {
  const contents = await readFile(path, "utf8");
  return contents.split("\n").slice(-lines).join("\n").trim();
}

async function runStep(
  step: ReleaseStep,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  logDirectory: string,
): Promise<StepResult> {
  const started = Date.now();
  const logPath = join(logDirectory, `${step.name}.log`);
  const log = createWriteStream(logPath, { flags: "wx", mode: 0o600 });
  console.log(`release check: ${step.name}`);
  const status = await new Promise<"passed" | "failed">((resolveStatus) => {
    const child = spawn(step.command, step.args, {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const timeout = setTimeout(() => {
      log.write(`\nrelease_step_timeout:${step.timeoutMs}\n`);
      child.kill("SIGTERM");
    }, step.timeoutMs);
    child.on("error", (error) => log.write(`\n${error.message}\n`));
    child.on("close", (code) => {
      clearTimeout(timeout);
      log.end(() => resolveStatus(code === 0 ? "passed" : "failed"));
    });
  });
  const result: StepResult = {
    name: step.name,
    status,
    duration_ms: Date.now() - started,
    log: `logs/${step.name}.log`,
  };
  if (status === "passed") console.log(`release check passed: ${step.name}`);
  else console.error(await tail(logPath));
  return result;
}

async function writeReport(path: string, report: ReleaseReport): Promise<void> {
  await writeFile(path, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
}

async function createArtifactPaths(): Promise<ArtifactPaths> {
  await mkdir(join(repositoryRoot, "codex-tmp"), { recursive: true });
  const artifactDirectory = await mkdtemp(
    join(repositoryRoot, "codex-tmp", "release-verification-"),
  );
  await chmod(artifactDirectory, 0o700);
  const paths: ArtifactPaths = {
    artifactDirectory,
    buildWorkspace: join(artifactDirectory, "build-workspace"),
    logDirectory: join(artifactDirectory, "logs"),
    npmCache: join(artifactDirectory, "npm-cache"),
    qualityWorkspace: join(artifactDirectory, "quality-workspace"),
  };
  await mkdir(paths.logDirectory);
  await mkdir(paths.npmCache);
  await writeFile(join(paths.npmCache, "empty-npmrc"), "", { mode: 0o600 });
  return paths;
}

async function executeReleaseChecks(
  options: ReleaseOptions,
  paths: ArtifactPaths,
): Promise<GateResult> {
  const results: StepResult[] = [];
  let activeWorkspace = paths.qualityWorkspace;
  let environment = releaseEnvironment(
    process.env,
    join(paths.qualityWorkspace, "codex-tmp", "release.sqlite"),
    paths.npmCache,
  );
  const cleanTree = await runStep(
    {
      name: "source-whitespace",
      command: "git",
      args: ["diff", "--check", "HEAD", "--"],
      timeoutMs: 60_000,
    },
    repositoryRoot,
    environment,
    paths.logDirectory,
  );
  results.push(cleanTree);
  if (cleanTree.status === "failed")
    return { status: "failed", steps: results };
  await prepareWorkspace(paths.qualityWorkspace);
  for (const step of releaseSteps(options.includeDatabase)) {
    if (step.name === "production-build") {
      await prepareWorkspace(paths.buildWorkspace);
      activeWorkspace = paths.buildWorkspace;
      environment = releaseEnvironment(
        process.env,
        join(paths.buildWorkspace, "codex-tmp", "release.sqlite"),
        paths.npmCache,
      );
    }
    const result = await runStep(
      step,
      activeWorkspace,
      environment,
      paths.logDirectory,
    );
    results.push(result);
    if (result.status === "failed") return { status: "failed", steps: results };
  }
  return { status: "passed", steps: results };
}

async function cleanupWorkspaces(
  paths: ArtifactPaths,
  keepWorkspace: boolean,
): Promise<boolean> {
  if (keepWorkspace) return true;
  let retained = false;
  for (const workspace of [paths.qualityWorkspace, paths.buildWorkspace]) {
    try {
      await rm(workspace, { recursive: true, force: true });
    } catch (error) {
      retained = true;
      const message =
        error instanceof Error ? error.message : "workspace_cleanup_failed";
      await writeFile(join(paths.logDirectory, "cleanup.log"), message + "\n", {
        flag: "a",
        mode: 0o600,
      });
    }
  }
  return retained;
}

async function main(): Promise<void> {
  const options = parseReleaseArguments(process.argv.slice(2));
  const paths = await createArtifactPaths();
  const startedAt = new Date().toISOString();
  let result: GateResult = { status: "failed", steps: [] };
  try {
    result = await executeReleaseChecks(options, paths);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "release_verification_failed";
    await writeFile(
      join(paths.logDirectory, "orchestration.log"),
      message + "\n",
      { mode: 0o600 },
    );
    console.error(message);
  } finally {
    const workspaceRetained = await cleanupWorkspaces(
      paths,
      options.keepWorkspace,
    );
    const report: ReleaseReport = {
      status: result.status,
      database_included: options.includeDatabase,
      workspace_retained: workspaceRetained,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      steps: result.steps,
    };
    const reportPath = join(paths.artifactDirectory, "report.json");
    await writeReport(reportPath, report);
    console.log(`release report: ${reportPath}`);
  }
  if (result.status === "failed") process.exitCode = 1;
}

await main();
