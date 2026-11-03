// Trailblazers — core game logic (shared by server, sample bot, tests).
// Board: 6x6. Players claim cells by moving; the cell you leave stays yours.
// Move: pawn moves 1 square in any of 8 directions onto an EMPTY cell.
// No legal move at your turn start -> eliminated. Last player standing wins;
// if the board fills, most claimed cells wins (ties -> lowest seat).

const SIZE = 6;
const CORNERS = [[0, 0], [5, 5], [0, 5], [5, 0]];
const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f'];

function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

function createGame(code, numPlayers) {
  const players = [];
  const pawns = {};
  const board = emptyBoard();
  for (let s = 0; s < numPlayers; s++) {
    const [r, c] = CORNERS[s];
    players.push({ seat: s, name: null, isBot: false, alive: true, color: COLORS[s] });
    pawns[s] = [r, c];
    board[r][c] = s;
  }
  return {
    code, size: SIZE, numPlayers,
    status: 'lobby', turn: 0, winner: null,
    players, pawns, board, log: [],
  };
}

function inBoard(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }

function legalMoves(game, seat) {
  const p = game.pawns[seat];
  if (!p || !game.players[seat].alive) return [];
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = p[0] + dr, c = p[1] + dc;
      if (inBoard(r, c) && game.board[r][c] === null) out.push([r, c]);
    }
  }
  return out;
}

function cellCounts(game) {
  const counts = game.players.map(() => 0);
  for (const row of game.board) for (const v of row) if (v !== null) counts[v]++;
  return counts;
}

function boardFull(game) {
  for (const row of game.board) for (const v of row) if (v === null) return false;
  return true;
}

// Advance turn, eliminating players with no moves. Returns 'playing' or 'finished'.
function nextAliveSeat(game, from) {
  for (let i = 1; i <= game.numPlayers; i++) {
    const s = (from + i) % game.numPlayers;
    if (game.players[s].alive) return s;
  }
  return null;
}

function finishLastStanding(game) {
  const alive = game.players.filter((p) => p.alive);
  game.status = 'finished';
  game.winner = alive.length === 1 ? alive[0].seat : null;
  game.log.push({ type: 'end', winner: game.winner, reason: 'last-standing' });
  return 'finished';
}

// Resolve the current turn: eliminate whoever sits on it with no moves until
// someone can move or the game ends. Also used when a bot is stuck.
function beginTurn(game) {
  let guard = 0;
  while (game.status === 'playing' && guard++ < 20) {
    const alive = game.players.filter((p) => p.alive);
    if (alive.length <= 1) return finishLastStanding(game);
    const cur = game.players[game.turn];
    if (!cur.alive) { game.turn = nextAliveSeat(game, game.turn); continue; }
    if (legalMoves(game, game.turn).length > 0) return 'playing';
    cur.alive = false;
    game.pawns[game.turn] = null;
    game.log.push({ type: 'eliminate', seat: game.turn });
    const still = game.players.filter((p) => p.alive);
    if (still.length <= 1) return finishLastStanding(game);
    game.turn = nextAliveSeat(game, game.turn);
  }
  return game.status === 'playing' ? 'playing' : 'finished';
}

function advanceTurn(game) {
  const nxt = nextAliveSeat(game, game.turn);
  if (nxt === null) return finishLastStanding(game);
  game.turn = nxt;
  return beginTurn(game);
}

function applyMove(game, seat, to) {
  if (game.status !== 'playing') return { ok: false, error: 'game not in progress' };
  if (game.turn !== seat) return { ok: false, error: 'not your turn' };
  if (!game.players[seat].alive) return { ok: false, error: 'you are eliminated' };
  const [r, c] = to;
  if (!inBoard(r, c)) return { ok: false, error: 'off board' };
  if (game.board[r][c] !== null) return { ok: false, error: 'cell already claimed' };
  const from = game.pawns[seat];
  const dr = Math.abs(r - from[0]), dc = Math.abs(c - from[1]);
  if (dr > 1 || dc > 1 || (dr === 0 && dc === 0)) return { ok: false, error: 'move must be to an adjacent cell' };
  game.board[r][c] = seat;
  game.pawns[seat] = [r, c];
  game.log.push({ type: 'move', seat, from, to });
  if (boardFull(game)) {
    const counts = cellCounts(game);
    let best = -1, winner = null;
    counts.forEach((n, s) => { if (n > best) { best = n; winner = s; } });
    game.status = 'finished';
    game.winner = winner;
    game.log.push({ type: 'end', winner, reason: 'board-full', counts });
    return { ok: true };
  }
  advanceTurn(game);
  return { ok: true };
}

// Flood-fill count of empty cells reachable from a cell (mobility heuristic).
function reachableEmpty(game, r, c) {
  const seen = new Set([`${r},${c}`]);
  const stack = [[r, c]];
  let n = 0;
  while (stack.length) {
    const [cr, cc] = stack.pop();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = cr + dr, nc = cc + dc;
        const key = `${nr},${nc}`;
        if (inBoard(nr, nc) && game.board[nr][nc] === null && !seen.has(key)) {
          seen.add(key); stack.push([nr, nc]); n++;
        }
      }
    }
  }
  return n;
}

// Sample-bot heuristic: maximize own mobility after the move, prefer moves
// that sit next to an opponent pawn (cut-off pressure). Ties -> first move.
function botChooseMove(game, seat) {
  const moves = legalMoves(game, seat);
  if (moves.length === 0) return null;
  let best = null, bestScore = -Infinity;
  for (const [r, c] of moves) {
    const saved = game.board[r][c];
    game.board[r][c] = seat;
    const mobility = reachableEmpty(game, r, c);
    game.board[r][c] = saved;
    let pressure = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (inBoard(nr, nc)) {
          const v = game.board[nr][nc];
          if (v !== null && v !== seat) {
            const pawn = game.pawns[v];
            if (pawn && pawn[0] === nr && pawn[1] === nc) pressure++;
          }
        }
      }
    }
    const score = mobility + 2 * pressure;
    if (score > bestScore) { bestScore = score; best = [r, c]; }
  }
  return best;
}

function publicState(game) {
  return {
    code: game.code, size: game.size, numPlayers: game.numPlayers,
    status: game.status, turn: game.turn, winner: game.winner,
    players: game.players.map((p) => ({ seat: p.seat, name: p.name, isBot: p.isBot, alive: p.alive, color: p.color })),
    pawns: game.pawns, board: game.board,
    counts: cellCounts(game), log: game.log,
  };
}

module.exports = { SIZE, CORNERS, COLORS, createGame, legalMoves, applyMove, botChooseMove, publicState, cellCounts, beginTurn };
