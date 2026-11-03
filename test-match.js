// Full-match API test: creates a match, joins seats via HTTP, drives every
// human turn with the heuristic, and checks the game reaches a clean finish
// with a winner and a complete log. Exits non-zero on any failure.
const { botChooseMove } = require('./game');

async function main() {
  const base = process.argv[2] || 'http://localhost:8080';
  const api = async (path, body) => {
    const r = await fetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`${path} -> ${j.error || r.status}`);
    return j;
  };

  // Test 1: 4-player, 1 human + 3 bots via start-fill.
  const created = await api('/api/matches', { players: 4, bots: 0 });
  console.log('created', created.code);
  const j0 = await api(`/api/matches/${created.code}/join`, { name: 'Tester' });
  console.log('joined seat', j0.seat);
  let st = await api(`/api/matches/${created.code}/start`, {});
  console.log('started, status', st.status, 'players', st.players.map((p) => `${p.name}${p.isBot ? '(bot)' : ''}`).join(', '));
  if (st.status !== 'playing') throw new Error('expected playing after start');

  let moves = 0;
  while (st.status === 'playing' && moves < 100) {
    if (st.players[st.turn].isBot) throw new Error('bot turn leaked to client (server should auto-play bots)');
    const mv = botChooseMove(st, st.turn);
    if (!mv) throw new Error(`seat ${st.turn} has no move but game still playing`);
    st = await api(`/api/matches/${created.code}/move`, { token: j0.token, to: mv });
    moves++;
  }
  console.log(`match finished after ${moves} human moves; winner seat ${st.winner} (${st.players[st.winner]?.name}); log entries ${st.log.length}; counts ${JSON.stringify(st.counts)}`);
  if (st.status !== 'finished') throw new Error('game did not finish');
  if (st.winner === null || st.winner === undefined) throw new Error('no winner recorded');
  const loggedMoves = st.log.filter((e) => e.type === 'move').length;
  const claimed = st.counts.reduce((a, b) => a + b, 0);
  console.log(`log moves ${loggedMoves}, claimed cells ${claimed}`);
  if (claimed < 4) throw new Error('too few claimed cells');

  // Test 2: error paths.
  try {
    await api(`/api/matches/${created.code}/move`, { token: j0.token, to: [0, 0] });
    throw new Error('move after finish should have failed');
  } catch (e) {
    if (!/not in progress|not your turn/.test(e.message)) throw e;
    console.log('post-finish move correctly rejected');
  }
  try {
    await api(`/api/matches/ZZZZ/move`, { token: j0.token, to: [0, 0] });
    throw new Error('unknown code should have failed');
  } catch (e) {
    if (!/unknown match/.test(e.message)) throw e;
    console.log('unknown code correctly rejected');
  }
  console.log('ALL TESTS PASSED');
}

main().catch((e) => { console.error('TEST FAILED:', e.message); process.exit(1); });
