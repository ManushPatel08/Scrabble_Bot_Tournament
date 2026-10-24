// One-shot health report for the single live bot (read-only).
//
//   node scripts/health.mjs
//
// Reads logs/runner-state.json, checks that the recorded launcher is alive
// (same PID and start time), how fresh the log is, recent late/slow/closed
// warnings, the A/B tally, and the public tournament / entry / team rows.
// Public SQL only, under a throwaway anonymous identity; no tokens are read.

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const H = process.env.STDB_HOST ?? "https://maincloud.spacetimedb.com";
const state = JSON.parse(fs.readFileSync("logs/runner-state.json", "utf8").replace(/^﻿/, ""));
const out = [];
const warn = [];

const ps = spawnSync("powershell", ["-NoProfile", "-Command",
  `$p = Get-Process -Id ${Number(state.launcherPid)} -ErrorAction SilentlyContinue; if ($p) { $p.StartTime.ToUniversalTime().ToString('o') }`], { encoding: "utf8" });
const started = ps.stdout.trim();
const alive = started && Math.abs(Date.parse(started) - Date.parse(state.processStartUtc)) < 2000;
out.push(`launcher ${state.launcherPid}: ${alive ? "running" : "NOT RUNNING"} | bot ${state.botId} team ${state.teamId} ${state.teamName}/${state.botName} | A=${state.paramsA ?? "default"} B=${state.paramsB ?? "-"} tournamentMode=${state.tournamentMode}`);
if (!alive) warn.push("launcher down");

const log = state.logFile.replace(/\\/g, "/");
if (fs.existsSync(log)) {
  const ageS = (Date.now() - fs.statSync(log).mtimeMs) / 1000;
  const lines = fs.readFileSync(log, "utf8").split("\n");
  const tail = lines.slice(-4000);
  const bad = tail.filter((l) => /\bSLOW\b|\bLATE\b|Auction closed|not running|\berror\b|refused|exited with code/.test(l));
  const ended = lines.filter((l) => / ended: place /.test(l));
  out.push(`log ${log}: last write ${ageS.toFixed(0)} s ago, ${ended.length} matches ended, ${bad.length} warnings in last ${tail.length} lines`);
  for (const l of bad.slice(-5)) out.push(`  ! ${l.slice(0, 200)}`);
  for (const l of ended.slice(-3)) out.push(`  ${l.slice(25, 220)}`);
  if (ageS > 180) warn.push(`log stale ${ageS.toFixed(0)} s`);
  if (state.paramsB) {
    const ab = spawnSync(process.execPath, ["scripts/ab-live.mjs", log, "--since", String(state.trialSince ?? 0)], { encoding: "utf8" });
    out.push(ab.stdout.trim());
  }
} else warn.push(`missing log ${log}`);

try {
  const { token } = await (await fetch(`${H}/v1/identity`, { method: "POST" })).json();
  const q = async (s) => {
    const r = await fetch(`${H}/v1/database/scrabblebot/sql`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: s });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json())[0].rows;
  };
  const tours = await q("SELECT * FROM tournament");
  out.push(`tournaments: ${tours.length ? JSON.stringify(tours) : "none"}`);
  const entries = await q(`SELECT * FROM tournament_entry WHERE bot_id = ${Number(state.botId)}`);
  out.push(`our entries: ${entries.length ? JSON.stringify(entries) : "none"}`);
  const members = await q(`SELECT team_id FROM team_member WHERE team_id = ${Number(state.teamId)}`);
  out.push(`team ${state.teamId} members: ${members.length}`);
  const stats = await q(`SELECT matches_played, wins, total_score, openskill_mu, openskill_sigma FROM bot_stats WHERE bot_id = ${Number(state.botId)}`);
  if (stats[0]) {
    const [n, w, total, mu, sigma] = stats[0];
    out.push(`bot_stats: ${n} matches, ${w} wins, mean score ${(Number(total) / Math.max(1, n)).toFixed(1)}, mu ${mu.toFixed(1)} sigma ${sigma.toFixed(2)}`);
  }
  if (tours.length) warn.push("tournament row present");
  if (members.length !== 1) warn.push(`team has ${members.length} members`);
} catch (e) {
  warn.push(`public query failed: ${e instanceof Error ? e.message : e}`);
}

console.log(out.join("\n"));
console.log(warn.length ? `ATTENTION: ${warn.join("; ")}` : "OK");
