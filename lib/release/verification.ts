import { isAbsolute } from "node:path";

export type ReleaseOptions = {
  includeDatabase: boolean;
  keepWorkspace: boolean;
};

export type ReleaseStep = {
  name: string;
  command: string;
  args: string[];
  timeoutMs: number;
};

const ALLOWED_ENVIRONMENT_KEYS = [
  "FORCE_COLOR",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
] as const;

const EXCLUDED_ROOT_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".vercel",
  "build",
  "codex-tmp",
  "data",
  "node_modules",
  "out",
]);

/** Parse the deliberately small release-verification CLI surface. */
export function parseReleaseArguments(args: string[]): ReleaseOptions {
  const options: ReleaseOptions = {
    includeDatabase: true,
    keepWorkspace: false,
  };
  for (const argument of args) {
    if (argument === "--skip-database") options.includeDatabase = false;
    else if (argument === "--keep-workspace") options.keepWorkspace = true;
    else throw new Error(`unknown_release_argument:${argument}`);
  }
  return options;
}

/** Reject paths that could copy local data, credentials, or generated state. */
export function isSafeReleaseSourcePath(path: string): boolean {
  if (!path || path.includes("\0") || path.includes("\\") || isAbsolute(path))
    return false;
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    return false;
  if (EXCLUDED_ROOT_DIRECTORIES.has(parts[0].toLowerCase())) return false;
  const name = parts.at(-1)?.toLowerCase() ?? "";
  if (name === "openrouter.key" || name === ".npmrc" || name === ".yarnrc")
    return false;
  if (name === ".env" || name.startsWith(".env.")) return false;
  if (name.endsWith(".pem") || name.endsWith(".key")) return false;
  if (/\.(?:db|sqlite|sqlite3)(?:-(?:journal|shm|wal))?$/.test(name))
    return false;
  return true;
}

/** Build a narrow child environment without credentials or deployment config. */
export function releaseEnvironment(
  environment: NodeJS.ProcessEnv,
  sqlitePath: string,
  npmCachePath: string,
): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of ALLOWED_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value !== undefined) clean[key] = value;
  }
  return {
    ...clean,
    CI: "1",
    DATABASE_BACKEND: "sqlite",
    NEXT_TELEMETRY_DISABLED: "1",
    SQLITE_DATABASE_PATH: sqlitePath,
    npm_config_audit: "false",
    npm_config_cache: npmCachePath,
    npm_config_fund: "false",
    npm_config_userconfig: `${npmCachePath}/empty-npmrc`,
    npm_config_update_notifier: "false",
  };
}

/** Return the ordered, credential-free release gate. */
export function releaseSteps(includeDatabase: boolean): ReleaseStep[] {
  const steps: ReleaseStep[] = [
    {
      name: "format",
      command: "npm",
      args: ["run", "format:check"],
      timeoutMs: 120_000,
    },
    {
      name: "route-types",
      command: "npm",
      args: ["run", "typegen"],
      timeoutMs: 120_000,
    },
    {
      name: "lint",
      command: "npm",
      args: ["run", "lint"],
      timeoutMs: 180_000,
    },
    {
      name: "types",
      command: "npm",
      args: ["run", "typecheck"],
      timeoutMs: 180_000,
    },
    {
      name: "offline-tests",
      command: "npm",
      args: ["test"],
      timeoutMs: 600_000,
    },
    {
      name: "production-build",
      command: "npm",
      args: ["run", "build"],
      timeoutMs: 600_000,
    },
    {
      name: "production-html",
      command: "npm",
      args: ["run", "test:next"],
      timeoutMs: 180_000,
    },
    {
      name: "production-runtime",
      command: "npm",
      args: ["run", "test:next:runtime"],
      timeoutMs: 600_000,
    },
  ];
  if (includeDatabase)
    steps.push({
      name: "disposable-postgres",
      command: "npm",
      args: ["run", "db:test:isolated"],
      timeoutMs: 600_000,
    });
  return steps;
}
