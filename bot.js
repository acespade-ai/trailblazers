// Sample agent for Trailblazers — plays one seat through the HTTP API only.
// Usage: node bot.js <baseUrl> <matchCode> <seatToken> <seat>
// (Join first via POST /api/matches/:code/join to get your token and seat.)
// It polls state, and whenever it is its turn, submits the heuristic move.
// The heuristic lives in game.js (mobility + cut-off pressure); the API
// interaction here is the part agents should copy.
const { botChooseMove } = require('./game');

async function main() {
  const [base, code, token, seatArg] = process.argv.slice(2);
  const seat = Number(seatArg);
  if (!base || !code || !token || Number.isNaN(seat)) {
    console.error('usage: node bot.js <baseUrl> <matchCode> <seatToken> <seat>');
    process.exit(2);
  }
  const api = async (path, body) => {
    const r = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  };
  // Resolve our seat from the join response (passed as an argument).
  console.log(`bot watching ${code} (seat ${seat})`);
  for (;;) {
    const st = await api(`/api/matches/${code}`);
    if (st.status === 'finished') {
      console.log(`game over, winner seat ${st.winner}`);
      break;
    }
    if (st.status === 'lobby') { await new Promise((r) => setTimeout(r, 1000)); continue; }
    if (st.turn === seat) {
      const mv = botChooseMove(st, seat);
      if (!mv) { console.log('no moves (should be eliminated shortly)'); await new Promise((r) => setTimeout(r, 1000)); continue; }
      const next = await api(`/api/matches/${code}/move`, { token, to: mv });
      console.log(`moved seat ${seat} -> [${mv}] (turn now ${next.turn}, status ${next.status})`);
      if (next.status === 'finished') { console.log(`game over, winner seat ${next.winner}`); break; }
    }
    await new Promise((r) => setTimeout(r, 800));
  }
}

main().catch((e) => { console.error('bot error:', e.message); process.exit(1); });
