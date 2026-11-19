import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
const root = fileURLToPath(new URL("../", import.meta.url));
const state = path.join(root, ".local");
const data = path.join(state, "postgres");
const envPath = path.join(root, ".env");
const action = process.argv[2] || "setup";
const run = (cmd, args, env = {}) => {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${cmd} failed${result.error ? `: ${result.error.message}` : ""}`,
    );
};
const probe = (cmd, args) =>
  spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
try {
  if (!["setup", "start", "stop"].includes(action))
    throw new Error("Use setup, start, or stop");
  const bin = probe("pg_config", ["--bindir"]);
  if (bin.status !== 0)
    throw new Error(
      "PostgreSQL binaries are missing. Install PostgreSQL 16+ and add its bin directory to PATH.",
    );
  const pg = (name) => path.join(bin.stdout.trim(), name);
  if (action === "stop") {
    if (
      fs.existsSync(data) &&
      probe(pg("pg_ctl"), ["-D", data, "status"]).status === 0
    )
      run(pg("pg_ctl"), ["-D", data, "stop", "-m", "fast"]);
    else console.log("The project database is already stopped.");
    process.exit(0);
  }
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  let text = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8")
    : fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const config = dotenv.parse(text);
  const set = (key, value) => {
    const line = `${key}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    text = pattern.test(text)
      ? text.replace(pattern, () => line)
      : `${text}\n${line}\n`;
    config[key] = value;
  };
  let url;
  if (config.DATABASE_URL) url = new URL(config.DATABASE_URL);
  const projectUrl =
    url?.hostname === "127.0.0.1" &&
    url?.port === "55433" &&
    url?.pathname === "/flurryhr";
  const exampleUrl =
    !url ||
    (["localhost", "127.0.0.1"].includes(url.hostname) &&
      (url.port || "5432") === "5432" &&
      url.pathname === "/flurryhr" &&
      url.username === "flurryhr" &&
      url.password === "flurryhr_local");
  if (!projectUrl && !exampleUrl)
    throw new Error(
      "DATABASE_URL has custom credentials. This local helper will not replace them. Use the configured database with db:migrate and db:seed, or back up backend/.env and remove DATABASE_URL to opt into the local database.",
    );
  if (!projectUrl) {
    if (fs.existsSync(data))
      throw new Error(
        "The local cluster already exists but its matching DATABASE_URL is missing. Restore backend/.env credentials before continuing.",
      );
    set(
      "DATABASE_URL",
      `postgresql://flurryhr:${randomBytes(24).toString("hex")}@127.0.0.1:55433/flurryhr?schema=public`,
    );
  }
  if (!config.MAIL_ENCRYPTION_KEY)
    set("MAIL_ENCRYPTION_KEY", randomBytes(32).toString("hex"));
  if (!config.SEED_ADMIN_EMAIL) set("SEED_ADMIN_EMAIL", "admin@flurrypay.com");
  if (!config.SEED_ADMIN_PASSWORD)
    set("SEED_ADMIN_PASSWORD", randomBytes(24).toString("base64url"));
  if (config.SEED_ADMIN_PASSWORD.length < 12)
    throw new Error("SEED_ADMIN_PASSWORD must contain at least 12 characters.");
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
  url = new URL(config.DATABASE_URL);
  const pgEnv = {
    PGHOST: "127.0.0.1",
    PGPORT: "55433",
    PGUSER: "flurryhr",
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: "postgres",
  };
  if (!fs.existsSync(data)) {
    const secretPath = path.join(state, "init-password");
    fs.writeFileSync(secretPath, `${pgEnv.PGPASSWORD}\n`, { mode: 0o600 });
    try {
      run(pg("initdb"), [
        "-D",
        data,
        "-U",
        "flurryhr",
        "-A",
        "scram-sha-256",
        "--pwfile",
        secretPath,
        "--encoding=UTF8",
        "--no-locale",
      ]);
    } finally {
      fs.rmSync(secretPath, { force: true });
    }
  }
  if (probe(pg("pg_ctl"), ["-D", data, "status"]).status !== 0)
    run(pg("pg_ctl"), [
      "-D",
      data,
      "-l",
      path.join(state, "postgres.log"),
      "-o",
      "-h 127.0.0.1 -p 55433 -k /tmp",
      "start",
    ]);
  const existing = spawnSync(
    pg("psql"),
    ["-tAc", "SELECT 1 FROM pg_database WHERE datname = 'flurryhr'"],
    { encoding: "utf8", env: { ...process.env, ...pgEnv } },
  );
  if (existing.status !== 0)
    throw new Error(
      "Cannot authenticate to the project database. Check the credentials in backend/.env.",
    );
  if (existing.stdout.trim() !== "1") run(pg("createdb"), ["flurryhr"], pgEnv);
  if (action === "setup") {
    const backupDir = path.join(state, "backups");
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const backupPath = path.join(
      backupDir,
      `before-migrate-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`,
    );
    run(pg("pg_dump"), ["-Fc", "-f", backupPath], {
      ...pgEnv,
      PGDATABASE: "flurryhr",
    });
    fs.chmodSync(backupPath, 0o600);
    console.log(
      "A private database backup was saved under backend/.local/backups before migration.",
    );
    run("npm", ["run", "db:generate"]);
    run("npm", ["run", "db:migrate"]);
    run("npm", ["run", "db:seed"]);
    console.log(
      "\nSetup complete. Your login email and generated password are in backend/.env (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).",
    );
    console.log(
      "Run npm run dev here for the API. In frontend/, run npm run dev and open http://localhost:5173.",
    );
  } else console.log("Project PostgreSQL is running on 127.0.0.1:55433.");
} catch (error) {
  console.error(`\nLocal database setup: ${error.message}`);
  process.exitCode = 1;
}
