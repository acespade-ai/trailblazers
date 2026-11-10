# Trailblazers

A small, polished turn-based multiplayer strategy game for 2–4 players, playable by humans in a browser and by AI agents over HTTP in the same match.

## Rules

Trailblazers is played on a 6×6 board where each player starts with a pawn in a corner, and on your turn you move your pawn one square in any direction (including diagonally) onto an empty cell, claiming the cell you arrive on while the cell you left stays claimed in your color, so the board steadily fills with territory; if you have no legal move when your turn comes, you are eliminated and your claimed cells stay as obstacles, and the last player still able to move wins, or, if the board fills completely, the player with the most claimed cells wins (ties go to the lowest seat).

## Play it

- **Live game:** see the TaskMarket submission for the public URL (hosted on InstaBox).
- **Humans:** open the URL, create a match (2–4 players) or join with a match code — no install, no login. Empty seats can be filled with bots, and the match log doubles as a replay (step through it with the replay buttons).
- **Agents:** join a match over the API below, poll state, and post moves when it is your turn. A sample bot is included (`bot.js`).

## Run it yourself

Requires Node.js 18+ (no dependencies, no build step):

```bash
node server.js          # listens on :8080, or set PORT
```

Then open http://localhost:8080.

## API docs

Base URL is the game URL. All bodies and responses are JSON. A match code is 4 letters (e.g. `TB7X`). A seat token is issued when you join; pass it on every move.

### Create a match

```
POST /api/matches
{ "players": 2-4, "bots": 0..players-1 }
-> { "code": "TB7X", ...state }
```

`bots` pre-fills seats with server bots. Human seats stay open until joined.

### Join a match

```
POST /api/matches/:code/join
{ "name": "YourName" }
-> { "seat": 0, "token": "<uuid>", ...state }
```

### Add a bot / start

```
POST /api/matches/:code/add-bot   { "name": "Bot-9" }   (lobby only)
POST /api/matches/:code/start     {}                     (lobby only; fills open seats with bots)
```

At least one human must have joined before starting. Server bots move automatically whenever it is their turn.

### Read state

```
GET /api/matches/:code
-> {
  "code", "size": 6, "numPlayers", "status": "lobby|playing|finished",
  "turn": <seat>, "winner": <seat|null>,
  "players": [{ "seat", "name", "isBot", "alive", "color" }],
  "pawns": { "<seat>": [row, col] | null },
  "board": [[<seat|null> x 6] x 6],
  "counts": [<cells per seat>],
  "log": [...]
}
```

Rows and columns are 0-based, row 0 at the top. `board[r][c]` is the seat that claimed the cell, or `null` if empty. A pawn sits on its owner's most recently claimed cell.

### Submit a move

```
POST /api/matches/:code/move
{ "token": "<your seat token>", "to": [row, col] }
-> state (after server bots have also moved, if any)
```

`to` must be adjacent to your pawn (including diagonally) and empty. Errors: `401 bad token`, `400 not your turn`, `400 cell already claimed`, `400 move must be to an adjacent cell`, `400 game not in progress`.

### Leave a match

```
POST /api/matches/:code/leave
{ "token": "<your seat token>" }   (token optional; always 200)
-> state
```

Leaving frees the seat in the lobby, or converts it to a bot mid-game so the remaining players are never stuck waiting on someone who left. The browser's "Start over" button calls this, then clears its cached match and returns to the lobby.

### Match log / replay

```
GET /api/matches/:code/log
-> { "log": [{ "type": "start|move|eliminate|end", ... }] }
```

`move` entries carry `seat`, `from`, and `to`; replay by starting from the `start` entry's pawns and applying moves in order (the browser UI does exactly this).

## Sample bot

```bash
# 1. Create a match, 2. join it to get a token + seat, 3. run the bot:
node bot.js http://localhost:8080 TB7X <your-token> <your-seat>
```

The bot polls state every ~0.8s and plays a greedy heuristic: it picks the move that maximizes the empty cells reachable afterwards, preferring moves that sit next to an opponent's pawn (cut-off pressure). The same heuristic drives the server's built-in bots.

## Design notes

- Matches run 3–8 minutes: the 6×6 board fills in at most 32 moves, and every move both gains ground and risks boxing yourself in, so there is no single dominant line — greedy expansion loses to a player who cuts you off.
- The server is a single zero-dependency Node process with in-memory matches; restarting it clears open matches (finished matches live on in their logs only while the process runs).
- InstaBox note: guest machines auto-suspend after 30 minutes idle, so a long-idle game URL may need a wake before first use; once awake, the server process keeps serving.
