// Prints a round-by-round trace of one match from seat 0's point of view.
//   node sim/trace.ts [seed] [mode] [field...]
import { runMatch } from "./engine.ts";
import { makeSeat } from "./registry.ts";
import { Agent } from "../src/strategy/agent.ts";
import { countsToString, letterIndex } from "../src/game/letters.ts";
import type { AuctionView, Decision, AuctionOutcome } from "../src/game/types.ts";
import "./strategies.ts";

const seed = Number(process.argv[2] ?? 1);
const mode = (process.argv[3] ?? "Vickrey") as "Vickrey" | "FirstPrice";
const field = process.argv.slice(4).length ? process.argv.slice(4) : ["agent", "agent:b", "agent:c", "agent:d", "agent:e"];

class Traced extends Agent {
  override onAuction(v: AuctionView): Decision {
    const before = countsToString(v.rack);
    const d = super.onAuction(v);
    const L = letterIndex(v.letter);
    const after = v.rack.slice();
    for (const w of d.words) for (const ch of w) after[ch.charCodeAt(0) - 65]!--;
    const val = this.p.mcValuation ? this.letterValue(L, after) : 0;
    const bal = v.balances[this.t.seat]!;
    console.log(
      `r${String(v.round).padStart(2)} bag ${String(v.bagTotal).padStart(2)} ${v.letter}  rack ${before.padEnd(14)} bal ${String(bal).padStart(3)} ` +
        `mu ${this.mu(bal).toFixed(2)} k ${this.futureCount()} val ${val.toFixed(1).padStart(5)} bid ${String(d.bid).padStart(3)}` +
        (d.words.length ? `  PLAY ${d.words.join(",")}` : ""),
    );
    return d;
  }
  override onAuctionResult(r: AuctionOutcome): void {
    super.onAuctionResult(r);
    console.log(`      -> winner ${r.winner === this.t.seat ? "ME" : r.winner} paid ${r.paid}`);
  }
}
const seats = [{ name: "traced", make: () => new Traced({}, "traced") }, ...field.map((f) => makeSeat(f))];
const res = runMatch(seats, { auctionType: mode, seed });
for (const s of res.seats) console.log(s.name.padEnd(12), "score", s.score, "rank", s.rank, "won", s.lettersWon, "spent", s.spent, "left", s.unplayedTiles);
