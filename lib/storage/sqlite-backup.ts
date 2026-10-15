import "server-only";
import { chmod, open } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";

export type SqliteBackupVerification = {
  integrity: "ok";
  schemaVersion: number;
  foreignKeyViolations: number;
};

/** Create an owner-only, transactionally consistent copy including committed WAL data. */
export async function backupSqliteDatabase(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  const destination = await open(destinationPath, "wx", 0o600);
  await destination.close();
  const database = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(database, destinationPath);
  } finally {
    database.close();
  }
  await chmod(destinationPath, 0o600);
}

/** Verify integrity, schema version, and foreign-key consistency without writing. */
export function verifySqliteBackup(path: string): SqliteBackupVerification {
  const database = new DatabaseSync(path, { readOnly: true });
  let transactionOpen = false;
  try {
    database.exec("pragma query_only = on; pragma busy_timeout = 5000; begin");
    transactionOpen = true;
    const integrity = Object.values(
      database.prepare("pragma quick_check").get() ?? {},
    )[0];
    const schemaVersion = Object.values(
      database.prepare("pragma user_version").get() ?? {},
    )[0];
    const foreignKeyViolations = database
      .prepare("pragma foreign_key_check")
      .all().length;
    if (
      integrity !== "ok" ||
      typeof schemaVersion !== "number" ||
      foreignKeyViolations !== 0
    )
      throw new Error("sqlite_backup_verification_failed");
    database.exec("commit");
    transactionOpen = false;
    return { integrity, schemaVersion, foreignKeyViolations };
  } catch (error) {
    if (transactionOpen) database.exec("rollback");
    throw error;
  } finally {
    database.close();
  }
}
