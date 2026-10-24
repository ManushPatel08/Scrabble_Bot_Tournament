// Explicit, one-time replacement through the normal logged-in account flow.
// Never creates another controller identity or bypasses team-membership rules.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { DbConnection } from "../src/module_bindings/index.js";

const arg = (key: string) => { const i = process.argv.indexOf(`--${key}`); return i < 0 ? undefined : process.argv[i + 1]; };
const fromId = arg("from-id");
const teamName = arg("team");
const botName = arg("bot");
if (!fromId || !/^\d+$/.test(fromId) || !teamName || !botName)
  throw new Error("Required: --from-id <existing bot id> --team <new team> --bot <bot name>");
const host = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const db = process.env.STDB_DB ?? "scrabblebot";
const runner = JSON.parse(fs.readFileSync("logs/runner-state.json", "utf8"));
if (String(runner.botId) !== fromId || !runner.stoppedAtUtc) throw new Error("Stop the expected launcher at a match boundary first");
const pidProbe = spawnSync("powershell", ["-NoProfile", "-Command", `if (Get-Process -Id ${Number(runner.launcherPid)} -ErrorAction SilentlyContinue) { exit 1 }`]);
if (pidProbe.status !== 0) throw new Error("The old launcher is still present; no registration changed");
const cli = `${process.env.LOCALAPPDATA}\\SpacetimeDB\\spacetime.exe`;
const login = spawnSync(cli, ["login", "show", "--token"], { encoding: "utf8" });
const token = `${login.stdout}\n${login.stderr}`.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0];
if (!token) throw new Error("Existing SpacetimeDB account login required");
const sql = async (query: string) => {
  const response = await fetch(`${host}/v1/database/${db}/sql`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: query });
  if (!response.ok) throw new Error(`Public preflight failed: HTTP ${response.status}`);
  return (await response.json())[0].rows as unknown[][];
};
const waitFor = async (test: () => boolean) => {
  const deadline = Date.now() + 15_000;
  while (!test()) {
    if (Date.now() >= deadline) throw new Error("Registration view update timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

let conn: DbConnection | undefined;
try {
  conn = await new Promise<DbConnection>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Registration connection timed out")), 30_000).unref();
    DbConnection.builder().withUri(host).withDatabaseName(db).withToken(token)
      .onConnect((connection) => { clearTimeout(timeout); resolve(connection); })
      .onConnectError(() => { clearTimeout(timeout); reject(new Error("Account connection failed")); }).build();
  });
  const active = conn;
  await new Promise<void>((resolve, reject) => active.subscriptionBuilder().onApplied(() => resolve())
    .onError(() => reject(new Error("Own-team view unavailable"))).subscribe(["SELECT * FROM my_team"]));
  const previous = [...active.db.myTeam.iter()][0];
  if (!previous || previous.botId !== BigInt(fromId) || previous.teamId !== BigInt(runner.teamId))
    throw new Error("Logged-in account does not own the expected registration; no changes made");
  const members = await sql(`SELECT team_id FROM team_member WHERE team_id = ${previous.teamId}`);
  if (members.length !== 1) throw new Error("Replacement requires exactly one team member; no changes made");
  const existingTeams = await sql("SELECT id, name FROM team");
  if (existingTeams.some(([, name]) => name === teamName)) throw new Error("Requested new team name is occupied; no changes made");
  const existingBots = await sql("SELECT id, name FROM bot");
  if (existingBots.some(([id, name]) => name === botName && String(id) !== fromId))
    throw new Error("Requested bot name is occupied by another bot; no changes made");
  const tournaments = await sql("SELECT id, status FROM tournament");
  const entries = await sql(`SELECT tournament_id FROM tournament_entry WHERE bot_id = ${fromId}`);
  if (entries.some(([id]) => tournaments.some(([tid, status]) => tid === id && ![0, 4, 5, 6].includes((status as number[])[0]!))))
    throw new Error("Bot is in an active tournament; no registration changed");
  const stats = await sql(`SELECT * FROM bot_stats WHERE bot_id = ${fromId}`);
  const tally = spawnSync(process.execPath, ["scripts/ab-live.mjs", runner.logFile, "--since", String(runner.trialSince ?? 0)], { encoding: "utf8" });
  const archive = { archivedAt: new Date().toISOString(), botId: Number(fromId), teamId: Number(previous.teamId),
    botName: previous.botName, teamName: previous.teamName, stats, abTally: tally.stdout,
    reason: "User explicitly requested a fresh replacement; incomplete trial is not a proven adoption." };
  fs.writeFileSync(`logs/retired-${fromId}-registration.json`, JSON.stringify(archive, null, 2));
  fs.copyFileSync(runner.logFile, `logs/retired-${fromId}-live.log`, fs.constants.COPYFILE_EXCL);
  console.log(`Archived ${previous.teamName} / ${previous.botName}, bot ${fromId}.`);

  // The owner leaves normally; the server applies its own tournament and
  // linked-human checks and removes the last-member registration atomically.
  await active.reducers.leaveTeam({});
  await waitFor(() => [...active.db.myTeam.iter()].length === 0);
  await active.reducers.createTeam({ teamName, botName });
  await waitFor(() => [...active.db.myTeam.iter()].some((t) => t.teamName === teamName && t.botName === botName));
  const created = [...active.db.myTeam.iter()][0]!;
  const path = "logs/registration-history.json";
  const history = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : [];
  history.push({ ...archive, stats: undefined, abTally: undefined }, { botId: Number(created.botId), teamId: Number(created.teamId),
    botName: created.botName, teamName: created.teamName, createdAt: new Date().toISOString() });
  fs.writeFileSync(path, JSON.stringify(history, null, 2));
  fs.writeFileSync("logs/new-registration.json", JSON.stringify({ botId: Number(created.botId), teamId: Number(created.teamId),
    botName: created.botName, teamName: created.teamName }, null, 2));
  console.log(`Created ${created.teamName} / ${created.botName}: team ${created.teamId}, bot ${created.botId}.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted]"));
  process.exitCode = 1;
} finally { conn?.disconnect(); }
