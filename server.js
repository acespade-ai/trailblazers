// Trailblazers server — zero-dependency Node HTTP server.
// Serves the browser game from ./public and the JSON API under /api.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createGame, legalMoves, applyMove, botChooseMove, publicState, beginTurn } = require('./game');

const PORT = process.env.PORT || 8080;
const matches = new Map(); // code -> { game, tokens: Map(token -> seat) }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (matches.has(code));
  return code;
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve(null); } });
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

// Play bot turns automatically until a human's turn or the game ends.
function runBots(match) {
  const { game } = match;
  let guard = 0;
  while (game.status === 'playing' && game.players[game.turn].isBot && guard++ < 200) {
    const mv = botChooseMove(game, game.turn);
    if (!mv) { beginTurn(game); continue; }
    applyMove(game, game.turn, mv);
  }
}

function seatOf(match, token) {
  return match.tokens.get(token);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  // Static frontend
  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(html);
  }
  if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true });

  // Create a match: { players: 2-4, bots: 0..players-1 }
  if (req.method === 'POST' && p === '/api/matches') {
    const b = await readBody(req);
    if (b === null) return send(res, 400, { error: 'bad json' });
    const numPlayers = b.players || 2;
    if (![2, 3, 4].includes(numPlayers)) return send(res, 400, { error: 'players must be 2, 3 or 4' });
    const bots = Math.min(Math.max(b.bots || 0, 0), numPlayers - 1);
    const code = newCode();
    const game = createGame(code, numPlayers);
    const match = { game, tokens: new Map() };
    for (let s = 0; s < bots; s++) {
      game.players[s].isBot = true;
      game.players[s].name = `Bot-${s + 1}`;
    }
    matches.set(code, match);
    return send(res, 200, { code, ...publicState(game) });
  }

  const m = p.match(/^\/api\/matches\/([A-Z0-9]{4})(?:\/(join|move|add-bot|start|log|leave))?$/);
  if (!m) return send(res, 404, { error: 'not found' });
  const match = matches.get(m[1]);
  if (!match) return send(res, 404, { error: 'unknown match code' });
  const { game } = match;

  if (req.method === 'GET' && !m[2]) return send(res, 200, publicState(game));
  if (req.method === 'GET' && m[2] === 'log') return send(res, 200, { log: game.log });

  const b = await readBody(req);
  if (b === null) return send(res, 400, { error: 'bad json' });

  if (req.method === 'POST' && m[2] === 'join') {
    if (game.status !== 'lobby') return send(res, 400, { error: 'match already started' });
    const seat = game.players.findIndex((pl) => !pl.isBot && pl.name === null);
    if (seat === -1) return send(res, 400, { error: 'no open seat' });
    const token = crypto.randomUUID();
    game.players[seat].name = (b.name || `Player ${seat + 1}`).slice(0, 40);
    match.tokens.set(token, seat);
    return send(res, 200, { seat, token, ...publicState(game) });
  }

  if (req.method === 'POST' && m[2] === 'add-bot') {
    if (game.status !== 'lobby') return send(res, 400, { error: 'match already started' });
    const seat = game.players.findIndex((pl) => !pl.isBot && pl.name === null);
    if (seat === -1) return send(res, 400, { error: 'no open seat' });
    game.players[seat].isBot = true;
    game.players[seat].name = b.name || `Bot-${seat + 1}`;
    return send(res, 200, publicState(game));
  }

  if (req.method === 'POST' && m[2] === 'start') {
    if (game.status !== 'lobby') return send(res, 400, { error: 'match already started' });
    const humans = game.players.filter((pl) => !pl.isBot && pl.name !== null).length;
    if (humans === 0) return send(res, 400, { error: 'at least one human must join first' });
    game.players.forEach((pl, s) => {
      if (!pl.isBot && pl.name === null) { pl.isBot = true; pl.name = `Bot-${s + 1}`; }
    });
    game.status = 'playing';
    game.turn = 0;
    game.log.push({ type: 'start', players: game.players.map((pl) => ({ seat: pl.seat, name: pl.name, isBot: pl.isBot })), pawns: game.pawns });
    runBots(match);
    return send(res, 200, publicState(game));
  }

  if (req.method === 'POST' && m[2] === 'leave') {
    // Escape hatch: always succeeds, even with a missing/stale token, so a
    // client can never get wedged on an old match. Lobby: the seat is freed
    // for someone else. Playing: the seat becomes a bot so the remaining
    // players are never stuck waiting on a human who left. Finished: no-op.
    const seat = seatOf(match, b.token);
    if (seat === undefined) return send(res, 200, publicState(game));
    match.tokens.delete(b.token);
    const pl = game.players[seat];
    if (game.status === 'lobby') {
      pl.name = null;
      pl.isBot = false;
    } else if (game.status === 'playing') {
      pl.isBot = true;
      if (game.turn === seat) runBots(match);
    }
    return send(res, 200, publicState(game));
  }

  if (req.method === 'POST' && m[2] === 'move') {
    const seat = seatOf(match, b.token);
    if (seat === undefined) return send(res, 401, { error: 'bad token' });
    if (!Array.isArray(b.to) || b.to.length !== 2) return send(res, 400, { error: 'to must be [row, col]' });
    const r = applyMove(game, seat, b.to);
    if (!r.ok) return send(res, 400, { error: r.error });
    runBots(match);
    return send(res, 200, publicState(game));
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`Trailblazers on :${PORT}`));
