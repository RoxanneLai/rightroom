import assert from "node:assert/strict";
import test from "node:test";
import {
  isSafeReleaseSourcePath,
  parseReleaseArguments,
  releaseEnvironment,
  releaseSteps,
} from "../../lib/release/verification.ts";

test("release verification defaults to the complete disposable database gate", () => {
  assert.deepEqual(parseReleaseArguments([]), {
    includeDatabase: true,
    keepWorkspace: false,
  });
  assert.deepEqual(
    parseReleaseArguments(["--skip-database", "--keep-workspace"]),
    {
      includeDatabase: false,
      keepWorkspace: true,
    },
  );
  assert.throws(() => parseReleaseArguments(["--unknown"]));
});

test("release steps keep build before production checks and Postgres last", () => {
  const complete = releaseSteps(true).map((step) => step.name);
  assert.ok(
    complete.indexOf("production-build") < complete.indexOf("production-html"),
  );
  assert.ok(
    complete.indexOf("production-build") <
      complete.indexOf("production-runtime"),
  );
  assert.equal(complete.at(-1), "disposable-postgres");
  assert.doesNotMatch(
    releaseSteps(false)
      .map((step) => step.name)
      .join(" "),
    /postgres/,
  );
});

test("release environment retains only process basics and synthetic storage", () => {
  const environment = releaseEnvironment(
    {
      PATH: "/synthetic/bin",
      LANG: "en_US.UTF-8",
      HOME: "/private/home",
      OPENROUTER_API_KEY: "private",
      SUPABASE_SERVICE_ROLE_KEY: "private",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "private",
      DATABASE_URL: "private",
    },
    "/synthetic/release.sqlite",
    "/synthetic/npm-cache",
  );
  assert.equal(environment.PATH, "/synthetic/bin");
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(environment.DATABASE_BACKEND, "sqlite");
  assert.equal(environment.SQLITE_DATABASE_PATH, "/synthetic/release.sqlite");
  assert.equal(
    environment.npm_config_userconfig,
    "/synthetic/npm-cache/empty-npmrc",
  );
  assert.equal(environment.HOME, undefined);
  assert.equal(environment.OPENROUTER_API_KEY, undefined);
  assert.equal(environment.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY, undefined);
  assert.equal(environment.DATABASE_URL, undefined);
});

test("release inventory rejects traversal, credentials, databases, and generated state", () => {
  for (const path of [
    "../package.json",
    "/tmp/package.json",
    "nested\\package.json",
    ".env",
    "config/.env.production",
    "OPENROUTER.key",
    "nested/deploy.key",
    "data/private-evidence.json",
    "data/founder-radar.sqlite",
    "data/founder-radar.sqlite-wal",
    "nested/private.sqlite3-journal",
    "DATA/private-evidence.json",
    ".next/server/app.js",
    "codex-tmp/report.json",
    "node_modules/next/package.json",
  ])
    assert.equal(isSafeReleaseSourcePath(path), false, path);
  for (const path of [
    "package.json",
    "app/page.tsx",
    "config/career.json",
    "supabase/migrations/20260101000000_schema.sql",
  ])
    assert.equal(isSafeReleaseSourcePath(path), true, path);
});
