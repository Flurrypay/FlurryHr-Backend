import { randomUUID } from "node:crypto";
import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
let partial;
try {
  const url = new URL(process.env.DATABASE_URL);
  if (
    process.env.NODE_ENV !== "development" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.port !== "55433"
  )
    throw Error(
      "This command only backs up the known local development database on port 55433. Production backup configuration is separate.",
    );
  const directory = path.resolve(".local/backups");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const file = path.join(
    directory,
    "flurryhr-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      "-" +
      randomUUID() +
      ".dump",
  );
  partial = file + ".partial";
  const pg =
    process.platform === "darwin" ? "/opt/homebrew/opt/postgresql@16/bin/" : "";
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1),
  };
  const backup = spawnSync(
    pg + "pg_dump",
    ["--format=custom", "--file", partial],
    { env, encoding: "utf8" },
  );
  if (backup.status !== 0)
    throw Error("Local backup failed. No migration should proceed.");
  fs.chmodSync(partial, 0o600);
  const archive = spawnSync(pg + "pg_restore", ["--list", partial], {
    env,
    encoding: "utf8",
  });
  if (archive.status !== 0) throw Error("Backup archive validation failed.");
  fs.renameSync(partial, file);
  partial = undefined;
  console.log("Private local backup created and archive validated: " + file);
  console.log(
    "Archive validation is not a restoration drill. Production scheduling, encryption, retention and alerting remain separate requirements.",
  );
} catch (error) {
  if (partial)
    try {
      fs.unlinkSync(partial);
    } catch {
      // Preserve the original failure if an incomplete archive cannot be removed.
    }
  console.error(
    error instanceof Error && !(error instanceof TypeError)
      ? error.message
      : "Local backup configuration is invalid",
  );
  process.exitCode = 1;
}
