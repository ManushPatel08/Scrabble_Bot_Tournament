// Gets a bot token without the website, using the module's own credential
// flow (spacetimedb/src/index.ts:303-519):
//
//   1. As you (your `spacetime login` identity): create the team and bot if
//      you have none yet, then mint a single-use credential nonce.
//   2. As a brand-new identity: redeem the nonce with claim_credential. That
//      identity is now a credential for your bot, and its token is the bot
//      token.
//
//   npm run get-token -- --team "<team name>" --bot "<bot name>"   (first time)
//   npm run get-token                                              (another token for your bot)
//   npm run get-token -- --code <nonce code>                       (redeem a code you already have)
//
// The bot token is copied to the clipboard and never printed, logged or
// saved: paste it into run.ps1's hidden prompt. Your login token is read from
// the spacetime CLI (`spacetime login show --token`) and only ever sent to
// the server.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DbConnection } from "../src/module_bindings/index.js";

const HOST = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const DB_NAME = process.env.STDB_DB ?? "scrabblebot";
const TIMEOUT_MS = 60_000;

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

// Errors are thrown, not process.exit()ed: exiting while a WebSocket is
// still closing trips a libuv assertion on Windows.
function fail(msg: string): never {
  throw new Error(msg);
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function withTimeout<T>(what: string, p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out ${what}`)), TIMEOUT_MS).unref()),
  ]);
}

// ------------------------------------------------------------ your identity

function cliPath(): string {
  const local = path.join(process.env.LOCALAPPDATA ?? "", "SpacetimeDB", "spacetime.exe");
  if (process.platform === "win32" && fs.existsSync(local)) return local;
  return "spacetime";
}

function loginToken(cli: string): string | null {
  const r = spawnSync(cli, ["login", "show", "--token"], { encoding: "utf8" });
  if (r.error) fail(`can't run the spacetime CLI (${r.error.message}). Install it from https://spacetimedb.com/install`);
  return `${r.stdout}\n${r.stderr}`.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0] ?? null;
}

function connect(token: string | undefined): Promise<{ conn: DbConnection; token: string }> {
  return withTimeout(
    "connecting",
    new Promise((resolve, reject) => {
      DbConnection.builder()
        .withUri(HOST)
        .withDatabaseName(DB_NAME)
        .withToken(token)
        .onConnect((conn, _identity, tok) => resolve({ conn, token: tok }))
        .onConnectError((_ctx, e) => reject(e))
        .build();
    }),
  );
}

/** As the logged-in human: make sure there's a team and bot, then mint a nonce. */
async function mintNonce(): Promise<{ code: string; botName: string }> {
  const cli = cliPath();
  let token = loginToken(cli);
  if (!token) {
    console.log("Log in to SpacetimeDB in the browser window that opens...");
    spawnSync(cli, ["login"], { stdio: "inherit" });
    token = loginToken(cli) ?? fail("no SpacetimeDB login found; run `spacetime login` and try again");
  }
  const { conn } = await connect(token);
  try {
    await withTimeout(
      "subscribing",
      new Promise<void>((resolve, reject) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve())
          .onError((_ctx) => reject(new Error("subscription failed")))
          .subscribe(["SELECT * FROM my_team", "SELECT * FROM my_nonces"]);
      }),
    );

    let team = Array.from(conn.db.myTeam.iter())[0];
    if (!team) {
      const teamName = arg("team");
      const botName = arg("bot");
      if (!teamName || !botName) fail('you are not on a team yet: pass --team "<team name>" --bot "<bot name>"');
      const created = new Promise<void>((resolve) => conn.db.myTeam.onInsert(() => resolve()));
      await withTimeout("creating the team", conn.reducers.createTeam({ teamName, botName }));
      await withTimeout("waiting for the team", created);
      team = Array.from(conn.db.myTeam.iter())[0] ?? fail("team created, but it isn't visible yet; run again");
      console.log(`Created team '${team.teamName}' with bot '${team.botName}'.`);
    } else {
      if (arg("bot") && arg("bot") !== team.botName) {
        console.log(`Note: you're already on team '${team.teamName}', whose bot is '${team.botName}'; using that.`);
      }
      console.log(`Team '${team.teamName}', bot '${team.botName}' (id ${team.botId}).`);
    }

    const before = new Set(Array.from(conn.db.myNonces.iter()).map((n) => n.id));
    const minted = new Promise<string>((resolve) =>
      conn.db.myNonces.onInsert((_ctx, n) => {
        if (!before.has(n.id)) resolve(n.code);
      }),
    );
    await withTimeout("minting a nonce", conn.reducers.mintCredentialNonce({}));
    const code = await withTimeout("waiting for the nonce", minted);
    return { code, botName: team.botName };
  } finally {
    conn.disconnect();
  }
}

// ------------------------------------------------------------ bot identity

/** As a brand-new identity: redeem the nonce. Returns that identity's token. */
async function claim(code: string): Promise<string> {
  const { conn, token } = await connect(undefined);
  try {
    await withTimeout("claiming the credential", conn.reducers.claimCredential({ code }));
    return token;
  } finally {
    conn.disconnect();
  }
}

function copyToClipboard(text: string): Promise<void> {
  const [cmd, args]: [string, string[]] =
    process.platform === "win32"
      ? ["clip.exe", []]
      : process.platform === "darwin"
        ? ["pbcopy", []]
        : ["xclip", ["-selection", "clipboard"]];
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    p.on("error", reject);
    p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} exited with ${c}`))));
    p.stdin.end(text);
  });
}

// ---------------------------------------------------------------- main

try {
  const given = arg("code");
  const { code, botName } = given ? { code: given, botName: "your bot" } : await mintNonce();
  const token = await claim(code);
  await copyToClipboard(token);
  console.log(
    `Done: a new token for ${botName === "your bot" ? botName : `'${botName}'`} is on the clipboard.\n` +
      "It isn't shown or saved anywhere. Paste it into run.ps1's prompt now (right-click or Ctrl+V),\n" +
      "and keep a copy in a password manager if you want to reuse it.",
  );
  process.exitCode = 0;
} catch (e) {
  console.error(`get-token: ${errMsg(e)}`);
  process.exitCode = 1;
}
