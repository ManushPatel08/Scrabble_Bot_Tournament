// Subscription queries. The live database keeps every match ever played
// (millions of auction, result and word rows), so subscribing to all tables
// exhausts the Node heap within seconds. The bot subscribes to its own slice
// instead: the small global tables first, then, once it knows its bot id,
// only the rows of matches it plays in (joined through match_participant,
// whose bot_id and match_id are indexed).

/** Small tables, needed before we know which bot we are. */
export const BASE_QUERIES: readonly string[] = [
  "SELECT * FROM bot_credential",
  "SELECT * FROM bot",
  "SELECT * FROM tournament",
];

/** This bot's rack, entries and lobbies, and every row of its own matches. */
export function botQueries(botId: bigint): string[] {
  const me = botId.toString();
  const ofMyMatches = (table: string, col = "match_id") =>
    `SELECT t.* FROM ${table} t JOIN match_participant p ON t.${col} = p.match_id WHERE p.bot_id = ${me}`;
  return [
    "SELECT * FROM my_rack",
    `SELECT * FROM tournament_entry WHERE bot_id = ${me}`,
    `SELECT * FROM lobby_member WHERE bot_id = ${me}`,
    `SELECT l.* FROM lobby l JOIN lobby_member m ON l.id = m.lobby_id WHERE m.bot_id = ${me}`,
    ofMyMatches("match_state", "id"),
    ofMyMatches("match_participant"),
    ofMyMatches("auction"),
    ofMyMatches("auction_result"),
    ofMyMatches("word_play"),
  ];
}
