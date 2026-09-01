import {
  MONOPOLY_AUTHORITY,
  monopolyWorth as authoritativeMonopolyWorth,
  validateMonopolyStart as validateAuthoritativeMonopolyStart,
  validateMonopolyTransition
} from "./monopoly-authority.js";
import {
  SORRY_AUTHORITY,
  validateSorryStart as validateAuthoritativeSorryStart,
  validateSorryTransition
} from "./sorry-transition-validator.js";

/*
 * Nearby-only semantic authority for the generic ArcadeRoom protocol.
 *
 * The Internet worker intentionally retains its deployed snapshot-parity API.
 * NearbyRoomService calls this module before accepting a GenericRoomModel
 * action, so a nearby peer cannot replace the canonical state with an
 * arbitrary snapshot merely because it owns the current seat.
 */

const TTT_SYMBOLS = new Set(["💩", "🦄", "X", "O", "⭐", "❤️", "🌈", "👻", "🤖", "👽", "😺", "🐶", "🍕", "💀"]);
const TTT_WINS = Object.freeze([[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]);
const SORRY_CARDS = Object.freeze({ "1":5, "2":4, "3":4, "4":4, "5":4, "7":4, "8":4, "10":4, "11":4, "12":4, S:4 });
const SORRY_COLORS = Object.freeze([
  Object.freeze({ key: "red", start: 4, entry: 2 }),
  Object.freeze({ key: "blue", start: 19, entry: 17 }),
  Object.freeze({ key: "yellow", start: 34, entry: 32 }),
  Object.freeze({ key: "green", start: 49, entry: 47 })
]);
const SORRY_SLIDES = Object.freeze([
  Object.freeze({ start:1, end:4, owner:"red", path:[1,2,3,4] }), Object.freeze({ start:9, end:13, owner:"blue", path:[9,10,11,12,13] }),
  Object.freeze({ start:16, end:19, owner:"blue", path:[16,17,18,19] }), Object.freeze({ start:24, end:28, owner:"yellow", path:[24,25,26,27,28] }),
  Object.freeze({ start:31, end:34, owner:"yellow", path:[31,32,33,34] }), Object.freeze({ start:39, end:43, owner:"green", path:[39,40,41,42,43] }),
  Object.freeze({ start:46, end:49, owner:"green", path:[46,47,48,49] }), Object.freeze({ start:54, end:58, owner:"red", path:[54,55,56,57,58] })
]);
const MONOPOLY_PROPERTY = Object.freeze({
  1:[60,30,50],3:[60,30,50],5:[200,100,0],6:[100,50,50],8:[100,50,50],9:[120,60,50],
  11:[140,70,100],12:[150,75,0],13:[140,70,100],14:[160,80,100],15:[200,100,0],
  16:[180,90,100],18:[180,90,100],19:[200,100,100],21:[220,110,150],23:[220,110,150],
  24:[240,120,150],25:[200,100,0],26:[260,130,150],27:[260,130,150],28:[150,75,0],
  29:[280,140,150],31:[300,150,200],32:[300,150,200],34:[320,160,200],35:[200,100,0],
  37:[350,175,200],39:[400,200,200]
});

export const GENERIC_GAME_AUTHORITY = Object.freeze({
  memory: Object.freeze({ id: "memory-transition-v1", ruleValidated: true, completionVerified: true, scope: "one resolved reveal group" }),
  "tic-tac-toe": Object.freeze({ id: "tic-tac-toe-transition-v1", ruleValidated: true, completionVerified: true, scope: "one mark or canonical round reset" }),
  dots: Object.freeze({ id: "dots-transition-v1", ruleValidated: true, completionVerified: true, scope: "one edge and its adjacent boxes" }),
  checkers: Object.freeze({ id: "checkers-transition-v1", ruleValidated: true, completionVerified: true, scope: "one move, one jump, or optional chain end" }),
  sorry: SORRY_AUTHORITY,
  monopoly: MONOPOLY_AUTHORITY,
  chat: Object.freeze({ id: "chat-message-v1", ruleValidated: true, completionVerified: false, scope: "server-authored identity, text bounds and rate limits" })
});

function gameError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function object(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
function clone(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function onlyKeys(value, keys, label) {
  const allowed = new Set(keys);
  requireValue(object(value) && Object.keys(value).every((key) => allowed.has(key)), `${label} contains unsupported fields`);
}
function activeMembers(room) { return room.members.filter((member) => !member.leftAt).sort((a, b) => a.seat - b.seat); }
function memberAtSeat(room, seat) { return activeMembers(room).find((member) => member.seat === seat) || null; }
function nextSeat(room, seat) {
  const seats = activeMembers(room).map((member) => member.seat);
  return seats.find((candidate) => candidate > seat) ?? seats[0] ?? null;
}
function requireValue(condition, message) { if (!condition) throw gameError(message); }
function requireNoFinish(action) { requireValue(action.finish !== true && !Object.hasOwn(action, "result"), "This game action cannot finish the room"); }
function expectedFinish(action, finish) { requireValue((action.finish === true) === finish, finish ? "The completed game must finish the room" : "The game is not finished"); }

function tttInfo(state) {
  onlyKeys(state, ["schema", "board", "turn", "scoreX", "scoreO", "symX", "symO", "roundOver"], "Tic Tac Toe state");
  requireValue(object(state) && state.schema === 1 && Array.isArray(state.board) && state.board.length === 9, "Invalid Tic Tac Toe state");
  requireValue(state.board.every((value) => value === "" || value === "X" || value === "O"), "Invalid Tic Tac Toe board");
  requireValue(state.turn === "X" || state.turn === "O", "Invalid Tic Tac Toe turn");
  requireValue(integer(state.scoreX, 0, 10000) && integer(state.scoreO, 0, 10000), "Invalid Tic Tac Toe score");
  requireValue(TTT_SYMBOLS.has(state.symX) && TTT_SYMBOLS.has(state.symO) && state.symX !== state.symO, "Invalid Tic Tac Toe symbols");
  const xCount = state.board.filter((cell) => cell === "X").length;
  const oCount = state.board.filter((cell) => cell === "O").length;
  requireValue(oCount <= xCount && xCount - oCount <= 1, "Invalid Tic Tac Toe move counts");
  const lines = TTT_WINS.filter((line) => state.board[line[0]] && line.every((index) => state.board[index] === state.board[line[0]]));
  const winners = new Set(lines.map((line) => state.board[line[0]]));
  requireValue(winners.size <= 1, "Both Tic Tac Toe players cannot win");
  const winner = winners.values().next().value || (state.board.every(Boolean) ? "D" : null);
  if (state.roundOver) {
    onlyKeys(state.roundOver, ["winner", "line"], "Tic Tac Toe result");
    requireValue(object(state.roundOver) && state.roundOver.winner === winner, "Invalid Tic Tac Toe round result");
    if (winner === "D") requireValue(xCount === 5 && oCount === 4 && state.roundOver.line === null, "Invalid Tic Tac Toe tie");
    else {
      requireValue((winner === "X" ? xCount === oCount + 1 : xCount === oCount), "Invalid Tic Tac Toe winning turn");
      requireValue(Array.isArray(state.roundOver.line) && lines.some((line) => same(line, state.roundOver.line)), "Invalid Tic Tac Toe winning line");
    }
    requireValue(state.turn === (winner === "O" ? "O" : "X"), "Invalid Tic Tac Toe terminal turn");
  } else {
    requireValue(!winner && state.turn === (xCount === oCount ? "X" : "O"), "Invalid Tic Tac Toe active turn");
  }
  return { winner, xCount, oCount };
}

function tttSeat(room, mark) {
  const members = activeMembers(room);
  return members[mark === "O" ? 1 : 0]?.seat ?? null;
}

function validateTicTacToeStart(room, action) {
  requireValue(activeMembers(room).length === 2, "Tic Tac Toe needs two players");
  const state = action.state;
  tttInfo(state);
  requireValue(state.board.every((cell) => !cell) && state.turn === "X" && state.scoreX === 0 && state.scoreO === 0 && state.roundOver === null, "Tic Tac Toe must start from an empty board");
  requireValue(Number(action.firstSeat ?? tttSeat(room, "X")) === tttSeat(room, "X"), "Tic Tac Toe must start with X");
}

function validateTicTacToeState(room, member, action) {
  const before = room.state, after = action.state;
  const beforeInfo = tttInfo(before), afterInfo = tttInfo(after);
  const actorMark = member.seat === tttSeat(room, "O") ? "O" : "X";
  requireValue(room.turn?.seat === member.seat && before.turn === actorMark, "Tic Tac Toe actor does not own this turn");
  requireValue(after.symX === before.symX && after.symO === before.symO, "Tic Tac Toe symbols cannot change during a game");
  requireNoFinish(action);

  if (before.roundOver) {
    requireValue(after.board.every((cell) => !cell) && after.turn === "X" && after.roundOver === null, "A completed Tic Tac Toe round may only reset to an empty board");
    requireValue(after.scoreX === before.scoreX && after.scoreO === before.scoreO, "Tic Tac Toe scores changed during round reset");
    requireValue(Number(action.nextSeat) === tttSeat(room, "X"), "Tic Tac Toe round reset must return to X");
    return;
  }

  const changed = [];
  for (let index = 0; index < 9; index++) if (before.board[index] !== after.board[index]) changed.push(index);
  requireValue(changed.length === 1 && before.board[changed[0]] === "" && after.board[changed[0]] === actorMark, "A Tic Tac Toe turn must place exactly one owned mark");
  if (afterInfo.winner) {
    const xDelta = after.scoreX - before.scoreX, oDelta = after.scoreO - before.scoreO;
    requireValue(xDelta === (afterInfo.winner === "X" ? 1 : 0) && oDelta === (afterInfo.winner === "O" ? 1 : 0), "Invalid Tic Tac Toe score award");
    requireValue(Number(action.nextSeat) === member.seat, "The round-ending Tic Tac Toe seat must retain reset authority");
  } else {
    requireValue(after.scoreX === before.scoreX && after.scoreO === before.scoreO && after.roundOver === null, "Tic Tac Toe score changed before a win");
    requireValue(after.turn === (actorMark === "X" ? "O" : "X") && Number(action.nextSeat) === tttSeat(room, after.turn), "Invalid Tic Tac Toe next player");
  }
  requireValue(beforeInfo.winner === null, "A completed Tic Tac Toe board cannot accept another mark");
}

function matrix(value, rows, cols, max) {
  return Array.isArray(value) && value.length === rows && value.every((row) => Array.isArray(row) && row.length === cols && row.every((cell) => integer(cell, 0, max)));
}

function dotsInfo(state) {
  onlyKeys(state, ["version", "DR", "DC", "BR", "BC", "TOTAL", "HO", "VO", "boxOwner", "boxAnim", "turn", "scores", "claimed", "history", "lastMove", "mode", "playerCount", "cpuLevel", "playerNames", "playerColors", "showTurnSplash", "teamPlay", "teams", "teamNames"], "Dots state");
  requireValue(object(state) && state.version === 2, "Invalid Dots state");
  const rows = state.DR, cols = state.DC, players = state.playerCount;
  requireValue(integer(rows, 2, 20) && integer(cols, 2, 20) && integer(players, 2, 4), "Invalid Dots dimensions");
  requireValue(state.BR === rows - 1 && state.BC === cols - 1 && state.TOTAL === (rows - 1) * (cols - 1), "Invalid Dots board totals");
  requireValue(state.mode === "online" && matrix(state.HO, rows, cols - 1, players) && matrix(state.VO, rows - 1, cols, players) && matrix(state.boxOwner, rows - 1, cols - 1, players), "Invalid Dots board");
  requireValue(integer(state.turn, 1, players), "Invalid Dots turn");
  requireValue(Array.isArray(state.history) && state.history.length === 0 && state.showTurnSplash === false && state.teamPlay === false, "Dots online configuration is invalid");
  requireValue(Array.isArray(state.playerNames) && state.playerNames.length >= players + 1 && state.playerNames.length <= 5 && state.playerNames[0] === null && state.playerNames.slice(1, players + 1).every((name) => typeof name === "string" && name.length >= 1 && name.length <= 24), "Invalid Dots player names");
  requireValue(Array.isArray(state.playerColors) && state.playerColors.length >= players + 1 && state.playerColors.length <= 5 && state.playerColors[0] === null && state.playerColors.slice(1, players + 1).every((color) => typeof color === "string" && color.length >= 1 && color.length <= 32), "Invalid Dots player colors");
  requireValue(Array.isArray(state.teams) && state.teams.length >= players + 1 && state.teams.length <= 5 && Array.isArray(state.teamNames) && state.teamNames.length >= 3 && state.teamNames.length <= 5, "Invalid Dots team configuration");
  const scores = new Array(players + 1).fill(0);
  for (let row = 0; row < rows - 1; row++) for (let col = 0; col < cols - 1; col++) {
    const closed = Boolean(state.HO[row][col] && state.HO[row + 1][col] && state.VO[row][col] && state.VO[row][col + 1]);
    const owner = state.boxOwner[row][col];
    requireValue(closed === Boolean(owner), "Dots box ownership does not match its edges");
    if (owner) scores[owner]++;
  }
  const claimed = scores.reduce((sum, score) => sum + score, 0);
  requireValue(Array.isArray(state.scores) && state.scores.length === players + 1 && same(state.scores, scores) && state.claimed === claimed, "Invalid Dots scores");
  return { rows, cols, players, scores, claimed, total: state.TOTAL };
}

function validateDotsStart(room, action) {
  const info = dotsInfo(action.state), members = activeMembers(room);
  requireValue(members.length === room.maxPlayers && info.players === room.maxPlayers, "Dots waits for every configured seat before starting");
  requireValue(members.every((member) => action.state.playerNames[member.seat + 1] === member.username), "Dots names must come from locked room identities");
  requireValue(action.state.turn === 1 && info.claimed === 0 && action.state.HO.every((row) => row.every((cell) => cell === 0)) && action.state.VO.every((row) => row.every((cell) => cell === 0)), "Dots must start from an empty grid");
  requireValue(Number(action.firstSeat ?? 0) === members[0].seat, "Dots must start with the first occupied seat");
}

function dotsResult(room, state, info) {
  const members = activeMembers(room), scores = members.map((member) => ({ seat: member.seat, score: info.scores[member.seat + 1] || 0 }));
  const best = Math.max(...scores.map((entry) => entry.score));
  const winners = scores.filter((entry) => entry.score === best);
  return { winnerSeat: winners.length === 1 ? winners[0].seat : null, tie: winners.length !== 1, scores };
}

function validateDotsState(room, member, action) {
  const before = room.state, after = action.state, a = dotsInfo(before), b = dotsInfo(after);
  requireValue(a.rows === b.rows && a.cols === b.cols && a.players === b.players, "Dots board settings cannot change during a game");
  const members = activeMembers(room);
  requireValue(members.every((locked) => before.playerNames[locked.seat + 1] === locked.username && after.playerNames[locked.seat + 1] === locked.username), "Dots names must come from locked room identities");
  requireValue(same(before.playerNames, after.playerNames) && same(before.playerColors, after.playerColors) && before.cpuLevel === after.cpuLevel && before.showTurnSplash === after.showTurnSplash && before.teamPlay === after.teamPlay && same(before.teams, after.teams) && same(before.teamNames, after.teamNames), "Dots online configuration cannot change during a game");
  requireValue(member.seat + 1 === before.turn, "Dots actor does not own this turn");
  const changes = [];
  for (const type of ["HO", "VO"]) for (let row = 0; row < before[type].length; row++) for (let col = 0; col < before[type][row].length; col++) {
    if (before[type][row][col] !== after[type][row][col]) changes.push({ type, row, col, from: before[type][row][col], to: after[type][row][col] });
  }
  requireValue(changes.length === 1 && changes[0].from === 0 && changes[0].to === member.seat + 1, "A Dots turn must claim exactly one empty edge");
  const change = changes[0], adjacent = change.type === "HO" ? [[change.row - 1, change.col], [change.row, change.col]] : [[change.row, change.col - 1], [change.row, change.col]];
  let points = 0;
  for (let row = 0; row < a.rows - 1; row++) for (let col = 0; col < a.cols - 1; col++) {
    const was = before.boxOwner[row][col], now = after.boxOwner[row][col];
    if (was !== now) {
      requireValue(was === 0 && now === member.seat + 1 && adjacent.some(([r, c]) => r === row && c === col), "Dots may only award a newly closed adjacent box");
      points++;
    }
  }
  requireValue(b.claimed === a.claimed + points, "Dots claimed-box count is inconsistent");
  const expectedPlayer = points ? member.seat + 1 : (nextSeat(room, member.seat) + 1);
  requireValue(after.turn === expectedPlayer && Number(action.nextSeat) === expectedPlayer - 1, "Invalid Dots next player");
  const finished = b.claimed === b.total;
  expectedFinish(action, finished);
  if (finished) requireValue(same(action.result, dotsResult(room, after, b)), "Invalid Dots winner or final score");
  else requireValue(!Object.hasOwn(action, "result"), "Dots result supplied before game completion");
}

function checkersBoard(value) {
  requireValue(Array.isArray(value) && value.length === 8 && value.every((row) => Array.isArray(row) && row.length === 8), "Invalid Checkers board");
  let red = 0, black = 0;
  const board = value.map((row, r) => row.map((raw, c) => {
    requireValue([-2, -1, 0, 1, 2].includes(raw) && (raw === 0 || (r + c) % 2 === 1), "Invalid Checkers piece");
    if (raw > 0) red++; if (raw < 0) black++;
    return raw;
  }));
  requireValue(red <= 12 && black <= 12, "Too many Checkers pieces");
  return board;
}

function checkersInfo(state) {
  onlyKeys(state, ["schema", "board", "turn", "mode", "chainLock", "baseSub", "cpuDifficulty", "selected", "gameStarted", "moveCount"], "Checkers state");
  requireValue(object(state) && state.schema === 2 && (state.turn === 1 || state.turn === -1) && state.mode === "online" && state.gameStarted === true, "Invalid Checkers state");
  const board = checkersBoard(state.board);
  requireValue(integer(state.moveCount, 0, 10000) && typeof state.chainLock === "boolean", "Invalid Checkers counters");
  const selected = state.selected === null ? null : state.selected;
  requireValue(selected === null || (object(selected) && integer(selected.r, 0, 7) && integer(selected.c, 0, 7)), "Invalid Checkers selection");
  return { board, selected };
}

function checkerDirs(piece) { return Math.abs(piece) === 2 ? [[-1,-1],[-1,1],[1,-1],[1,1]] : piece > 0 ? [[-1,-1],[-1,1]] : [[1,-1],[1,1]]; }
function inside(row, col) { return row >= 0 && row < 8 && col >= 0 && col < 8; }
function checkerMoves(board, turn, selected = null, jumpsOnly = false) {
  const moves = [];
  for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
    if (selected && (selected.r !== row || selected.c !== col)) continue;
    const piece = board[row][col]; if (!piece || Math.sign(piece) !== turn) continue;
    for (const [dr, dc] of checkerDirs(piece)) {
      const r1 = row + dr, c1 = col + dc, r2 = row + dr * 2, c2 = col + dc * 2;
      if (inside(r2, c2) && board[r1][c1] && Math.sign(board[r1][c1]) === -turn && board[r2][c2] === 0) moves.push({ from:[row,col], to:[r2,c2], cap:[r1,c1] });
      if (!jumpsOnly && inside(r1, c1) && board[r1][c1] === 0) moves.push({ from:[row,col], to:[r1,c1], cap:null });
    }
  }
  return moves;
}

function applyCheckerMove(boardValue, move) {
  const board = boardValue.map((row) => row.slice()), piece = board[move.from[0]][move.from[1]];
  board[move.from[0]][move.from[1]] = 0; board[move.to[0]][move.to[1]] = piece;
  if (move.cap) board[move.cap[0]][move.cap[1]] = 0;
  if (piece === 1 && move.to[0] === 0) board[move.to[0]][move.to[1]] = 2;
  if (piece === -1 && move.to[0] === 7) board[move.to[0]][move.to[1]] = -2;
  return board;
}

function checkerWinner(board, turn) {
  let red = 0, black = 0;
  for (const row of board) for (const piece of row) { if (piece > 0) red++; if (piece < 0) black++; }
  if (!red) return -1; if (!black) return 1;
  return checkerMoves(board, turn).length ? null : -turn;
}

function standardCheckersBoard() {
  return Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => (row + col) % 2 !== 1 ? 0 : row < 3 ? -1 : row > 4 ? 1 : 0));
}

function validateCheckersStart(room, action) {
  const info = checkersInfo(action.state);
  requireValue(activeMembers(room).length === 2 && same(info.board, standardCheckersBoard()) && action.state.turn === 1 && !action.state.chainLock && info.selected === null && action.state.moveCount === 0, "Checkers must start from the standard board");
  requireValue(Number(action.firstSeat ?? 0) === activeMembers(room)[0].seat, "Checkers must start with Red");
}

function validateCheckersResult(room, action, winner) {
  const winnerSeat = winner === 1 ? activeMembers(room)[0]?.seat : activeMembers(room)[1]?.seat;
  expectedFinish(action, Boolean(winner));
  if (winner) requireValue(same(action.result, { winnerSeat, winnerColor: winner === 1 ? "red" : "black" }), "Invalid Checkers winner");
  else requireValue(!Object.hasOwn(action, "result"), "Checkers result supplied before completion");
}

function validateCheckersState(room, member, action) {
  const before = room.state, after = action.state, a = checkersInfo(before), b = checkersInfo(after), actor = member.seat === activeMembers(room)[1]?.seat ? -1 : 1;
  requireValue(before.turn === actor && room.turn?.seat === member.seat, "Checkers actor does not own this turn");
  if (before.chainLock && same(a.board, b.board)) {
    requireValue(a.selected && after.turn === -actor && !after.chainLock && b.selected === null && after.moveCount === before.moveCount, "Invalid Checkers optional chain end");
    requireValue(Number(action.nextSeat) === (after.turn === 1 ? activeMembers(room)[0].seat : activeMembers(room)[1].seat), "Invalid Checkers next player");
    validateCheckersResult(room, action, checkerWinner(b.board, after.turn));
    return;
  }
  const legal = checkerMoves(a.board, actor, before.chainLock ? a.selected : null, before.chainLock);
  const match = legal.find((move) => same(applyCheckerMove(a.board, move), b.board));
  requireValue(match && after.moveCount === before.moveCount + 1, "Checkers snapshot is not one legal move");
  const more = match.cap ? checkerMoves(b.board, actor, { r: match.to[0], c: match.to[1] }, true) : [];
  if (more.length) {
    requireValue(after.turn === actor && after.chainLock && same(b.selected, { r: match.to[0], c: match.to[1] }), "A Checkers jump chain must retain its piece and turn");
    requireValue(Number(action.nextSeat) === member.seat, "A Checkers jump chain must retain its seat");
    validateCheckersResult(room, action, null);
  } else {
    requireValue(after.turn === -actor && !after.chainLock && b.selected === null, "Checkers turn did not advance after the move");
    requireValue(Number(action.nextSeat) === (after.turn === 1 ? activeMembers(room)[0].seat : activeMembers(room)[1].seat), "Invalid Checkers next player");
    validateCheckersResult(room, action, checkerWinner(b.board, after.turn));
  }
}

function memoryInfo(state) {
  onlyKeys(state, ["schema", "players", "seatOrder", "names", "teams", "uniqueTeams", "teamMode", "teamNames", "cols", "rows", "matchSize", "freeCount", "totalMatches", "deck", "revealed", "matchedKeys", "owners", "lock", "awaitingTurn", "moves", "tElapsed", "scores", "turn", "stats", "sound"], "Memory state");
  requireValue(object(state) && state.schema === 1 && integer(state.players, 2, 4), "Invalid Memory state");
  const players = state.players, cols = state.cols, rows = state.rows, matchSize = state.matchSize;
  requireValue(integer(cols, 2, 9) && integer(rows, 2, 9) && integer(matchSize, 2, 3), "Invalid Memory board settings");
  const playable = cols * rows - ((cols * rows) % matchSize), total = playable / matchSize;
  requireValue(state.totalMatches === total && Array.isArray(state.seatOrder) && state.seatOrder.length === players && new Set(state.seatOrder).size === players, "Invalid Memory seats or pair count");
  requireValue(state.seatOrder.every((seat) => integer(seat, 0, 7)) && Array.isArray(state.deck) && state.deck.length === playable, "Invalid Memory deck");
  requireValue(Array.isArray(state.names) && state.names.length === players && state.names.every((name) => typeof name === "string" && name.length >= 1 && name.length <= 24), "Invalid Memory player names");
  requireValue(Array.isArray(state.teams) && state.teams.length === players && state.teams.every((team) => integer(team, 1, players)) && Array.isArray(state.uniqueTeams) && same(state.uniqueTeams, Array.from(new Set(state.teams))), "Invalid Memory teams");
  requireValue(state.teamMode === false && Array.isArray(state.teamNames) && state.teamNames.length === 4 && state.teamNames.every((name) => typeof name === "string" && name.length >= 1 && name.length <= 24), "Invalid Memory online team configuration");
  requireValue(state.freeCount === 0 && Array.isArray(state.revealed) && state.revealed.length === 0 && state.lock === false && state.awaitingTurn === false && Number.isFinite(state.tElapsed) && state.tElapsed >= 0 && typeof state.sound === "boolean", "Invalid Memory online snapshot boundary");
  const keys = new Map(), ids = new Set();
  for (const card of state.deck) {
    requireValue(object(card) && typeof card.id === "string" && card.id.length <= 40 && !ids.has(card.id) && typeof card.key === "string" && card.key && card.key.length <= 16 && typeof card.emoji === "string" && card.emoji.length <= 16, "Invalid Memory card");
    ids.add(card.id); keys.set(card.key, (keys.get(card.key) || 0) + 1);
  }
  requireValue(keys.size === total && Array.from(keys.values()).every((count) => count === matchSize), "Invalid Memory match groups");
  requireValue(Array.isArray(state.matchedKeys) && new Set(state.matchedKeys).size === state.matchedKeys.length && state.matchedKeys.every((key) => keys.has(key)), "Invalid Memory matched groups");
  requireValue(Array.isArray(state.owners) && state.owners.length === playable && state.owners.every((owner) => integer(owner, 0, players)), "Invalid Memory owners");
  const scores = new Array(players).fill(0), matched = new Set(state.matchedKeys);
  for (const key of keys.keys()) {
    const indexes = state.deck.map((card, index) => card.key === key ? index : -1).filter((index) => index >= 0), owners = indexes.map((index) => state.owners[index]);
    if (matched.has(key)) {
      requireValue(owners[0] > 0 && owners.every((owner) => owner === owners[0]), "A matched Memory group must have one owner");
      scores[owners[0] - 1]++;
    } else requireValue(owners.every((owner) => owner === 0), "An unmatched Memory card cannot have an owner");
  }
  requireValue(Array.isArray(state.scores) && same(state.scores, scores) && integer(state.moves, 0, 100000) && integer(state.turn, 1, players), "Invalid Memory scores or turn");
  requireValue(Array.isArray(state.stats) && state.stats.length === players, "Invalid Memory statistics");
  const statFields = ["matches", "attempts", "misses", "flips", "curStreak", "longestStreak", "totalDecision", "decisionCount", "mismatchPairCounts", "bestRepeat"];
  const stats = state.stats.map((stat, index) => {
    onlyKeys(stat, statFields, "Memory statistics");
    for (const field of statFields.filter((field) => field !== "mismatchPairCounts")) requireValue(integer(stat[field], 0, field === "totalDecision" ? 86400000 : 100000), "Invalid Memory statistic");
    requireValue(object(stat.mismatchPairCounts) && Object.keys(stat.mismatchPairCounts).length <= 2048, "Invalid Memory mismatch history");
    for (const [key, count] of Object.entries(stat.mismatchPairCounts)) requireValue(key.length > 0 && key.length <= 64 && integer(count, 1, 100000), "Invalid Memory mismatch history");
    requireValue(stat.matches === scores[index] && stat.attempts === stat.matches + stat.misses && stat.flips === stat.attempts * matchSize && stat.decisionCount === stat.attempts, "Memory statistics do not match the board");
    requireValue(stat.curStreak <= stat.longestStreak && stat.longestStreak <= stat.matches, "Invalid Memory streak statistics");
    return stat;
  });
  requireValue(stats.reduce((sum, stat) => sum + stat.attempts, 0) === state.moves, "Memory move count does not match its statistics");
  return { players, cols, rows, matchSize, total, keys, scores, matched, stats };
}

function validateMemoryStart(room, action) {
  const state = action.state, info = memoryInfo(state), members = activeMembers(room);
  requireValue(info.players === members.length && same(state.seatOrder, members.map((member) => member.seat)), "Memory seats must match room membership");
  requireValue(same(state.names, members.map((member) => member.username)), "Memory names must come from locked room identities");
  requireValue(state.turn === 1 && state.moves === 0 && state.matchedKeys.length === 0 && state.owners.every((owner) => owner === 0), "Memory must start with a hidden board");
  requireValue(Number(action.firstSeat ?? members[0].seat) === members[0].seat, "Memory must start with its first seat");
}

function memoryResult(state) {
  const best = Math.max(...state.scores);
  return { scores: state.scores.slice(), winners: state.scores.map((score, index) => ({ score, index })).filter((entry) => entry.score === best).map((entry) => state.names[entry.index]) };
}

function validateMemoryStatsTransition(beforeInfo, afterInfo, actor, matched) {
  for (let index = 0; index < beforeInfo.stats.length; index++) {
    const before = beforeInfo.stats[index], after = afterInfo.stats[index];
    if (index !== actor - 1) { requireValue(same(before, after), "Only the acting player's Memory statistics may change"); continue; }
    requireValue(after.attempts === before.attempts + 1 && after.flips === before.flips + beforeInfo.matchSize && after.decisionCount === before.decisionCount + 1 && after.totalDecision >= before.totalDecision, "Invalid Memory attempt statistics");
    if (matched) {
      requireValue(after.matches === before.matches + 1 && after.misses === before.misses && after.curStreak === before.curStreak + 1 && after.longestStreak === Math.max(before.longestStreak, after.curStreak), "Invalid Memory match statistics");
      requireValue(after.bestRepeat === before.bestRepeat && same(after.mismatchPairCounts, before.mismatchPairCounts), "A Memory match cannot alter mismatch history");
    } else {
      requireValue(after.matches === before.matches && after.misses === before.misses + 1 && after.curStreak === 0 && after.longestStreak === before.longestStreak, "Invalid Memory miss statistics");
      const changedKeys = new Set([...Object.keys(before.mismatchPairCounts), ...Object.keys(after.mismatchPairCounts)]);
      const increments = Array.from(changedKeys).filter((key) => (after.mismatchPairCounts[key] || 0) !== (before.mismatchPairCounts[key] || 0));
      requireValue(increments.length === 1 && after.mismatchPairCounts[increments[0]] === (before.mismatchPairCounts[increments[0]] || 0) + 1, "A Memory miss must record exactly one reveal group");
      requireValue(after.bestRepeat === Math.max(before.bestRepeat, after.mismatchPairCounts[increments[0]]), "Invalid Memory repeat statistic");
    }
  }
}

function validateMemoryState(room, member, action) {
  const before = room.state, after = action.state, a = memoryInfo(before), b = memoryInfo(after);
  requireValue(a.players === b.players && a.cols === b.cols && a.rows === b.rows && a.matchSize === b.matchSize && same(before.seatOrder, after.seatOrder) && same(before.deck, after.deck), "Memory board configuration cannot change during a turn");
  const members = activeMembers(room), lockedNames = members.map((locked) => locked.username);
  requireValue(same(before.names, lockedNames) && same(after.names, lockedNames), "Memory names must come from locked room identities");
  requireValue(same(before.teams, after.teams) && same(before.uniqueTeams, after.uniqueTeams) && before.teamMode === after.teamMode && same(before.teamNames, after.teamNames) && before.freeCount === after.freeCount && before.totalMatches === after.totalMatches, "Memory online configuration cannot change during a turn");
  const actor = before.seatOrder.indexOf(member.seat) + 1;
  requireValue(actor > 0 && before.turn === actor && room.turn?.seat === member.seat, "Memory actor does not own this turn");
  requireValue(after.moves === before.moves + 1, "A Memory turn must resolve exactly one reveal group");
  const added = after.matchedKeys.filter((key) => !a.matched.has(key));
  requireValue(after.matchedKeys.every((key) => a.matched.has(key) || added.includes(key)) && added.length <= 1 && before.matchedKeys.every((key) => b.matched.has(key)), "A Memory turn can match at most one new group");
  if (added.length) {
    for (let index = 0; index < before.deck.length; index++) {
      if (a.matched.has(before.deck[index].key)) requireValue(after.owners[index] === before.owners[index], "A prior Memory match cannot change owner");
      if (before.deck[index].key === added[0]) requireValue(after.owners[index] === actor, "A new Memory match belongs to the acting player");
    }
    requireValue(after.turn === actor && Number(action.nextSeat) === member.seat, "A Memory match keeps the turn");
    validateMemoryStatsTransition(a, b, actor, true);
  } else {
    requireValue(same(after.owners, before.owners) && same(after.scores, before.scores), "A Memory miss cannot change ownership or scores");
    const expectedSeat = nextSeat(room, member.seat), expectedTurn = before.seatOrder.indexOf(expectedSeat) + 1;
    requireValue(after.turn === expectedTurn && Number(action.nextSeat) === expectedSeat, "A Memory miss must pass to the next occupied seat");
    validateMemoryStatsTransition(a, b, actor, false);
  }
  const finished = after.matchedKeys.length === b.total;
  expectedFinish(action, finished);
  if (finished) requireValue(same(action.result, memoryResult(after)), "Invalid Memory winner or scores");
  else requireValue(!Object.hasOwn(action, "result"), "Memory result supplied before completion");
}

function sorryInfo(state, room) {
  requireValue(object(state) && state.version === 5 && state.started === true && Array.isArray(state.players) && integer(state.players.length, 2, 4), "Invalid Sorry state");
  const players = state.players;
  requireValue(Array.isArray(state.pawns) && state.pawns.length === players.length * 3 && integer(state.turn, 0, players.length - 1), "Invalid Sorry pawns or turn");
  const seats = new Set(), colors = new Set();
  players.forEach((player, index) => {
    requireValue(object(player) && player.id === index && integer(player.seat, 0, room.maxPlayers - 1) && !seats.has(player.seat) && integer(player.colorIndex, 0, 3) && !colors.has(player.colorIndex), "Invalid Sorry player mapping");
    seats.add(player.seat); colors.add(player.colorIndex);
  });
  const occupiedTrack = new Set(), occupiedSafety = new Set();
  state.pawns.forEach((pawn, index) => {
    const player = Math.floor(index / 3), slot = index % 3;
    requireValue(object(pawn) && pawn.id === index && pawn.player === player && pawn.slot === slot && ["start", "track", "safety", "home"].includes(pawn.zone) && Number.isInteger(pawn.pos), "Invalid Sorry pawn");
    requireValue((pawn.zone === "start" || pawn.zone === "home") ? pawn.pos === 0 : pawn.zone === "track" ? integer(pawn.pos, 0, 59) : integer(pawn.pos, 0, 4), "Invalid Sorry pawn position");
    if (pawn.zone === "track") { requireValue(!occupiedTrack.has(pawn.pos), "Two Sorry pawns share a track space"); occupiedTrack.add(pawn.pos); }
    if (pawn.zone === "safety") { const key = `${player}:${pawn.pos}`; requireValue(!occupiedSafety.has(key), "Two Sorry pawns share a Safety space"); occupiedSafety.add(key); }
  });
  const counts = {};
  const count = (cards) => { requireValue(Array.isArray(cards), "Invalid Sorry cards"); for (const card of cards) { requireValue(Object.hasOwn(SORRY_CARDS, card), "Invalid Sorry card"); counts[card] = (counts[card] || 0) + 1; } };
  count(state.deck); count(state.discard);
  requireValue(Array.isArray(state.hands) && state.hands.length === players.length, "Invalid Sorry hands"); state.hands.forEach(count);
  if (state.currentCard !== null && state.mode !== "strategic") { requireValue(Object.hasOwn(SORRY_CARDS, state.currentCard), "Invalid current Sorry card"); counts[state.currentCard] = (counts[state.currentCard] || 0) + 1; }
  requireValue(Object.entries(SORRY_CARDS).every(([card, total]) => counts[card] === total), "Sorry card deck is not conserved");
  requireValue(["fireIce", "classic", "strategic"].includes(state.mode) && integer(state.moveNo, 0, 100000), "Invalid Sorry mode or move count");
  requireValue(["preFire", "draw", "chooseCard", "ice", "fireToken", "action", "noMove", "resolving", "firePull", "gameOver"].includes(state.phase), "Invalid Sorry phase");
  const winner = state.winner;
  requireValue(winner === null || integer(winner, 0, players.length - 1), "Invalid Sorry winner");
  if (winner !== null) requireValue(state.pawns.filter((pawn) => pawn.player === winner && pawn.zone === "home").length === 3 && state.phase === "gameOver", "Sorry winner does not have every pawn Home");
  return { players, winner };
}

function validateSorryStart(room, action) {
  const state = action.state, info = sorryInfo(state, room), members = activeMembers(room);
  requireValue(info.players.length === members.length && same(state.players.map((player) => player.seat), members.map((member) => member.seat)), "Sorry seats must match room membership");
  requireValue(state.pawns.every((pawn) => pawn.zone === "start") && state.moveNo === 0 && state.currentCard === null && state.winner === null && (state.phase === "draw" || state.phase === "chooseCard"), "Sorry must start from Start with no played card");
  requireValue(Number(action.firstSeat ?? members[0].seat) === members[0].seat, "Sorry must start with its first occupied seat");
}

function sorryColor(state, playerIndex) { return SORRY_COLORS[state.players[playerIndex]?.colorIndex] || SORRY_COLORS[playerIndex] || SORRY_COLORS[0]; }
function sorryPawn(state, id) { return state.pawns[id] || null; }
function sorryIced(state, id) { return state.icePawnId === id; }
function sorryTrackPawn(state, position, excluded = -1) { return state.pawns.find((pawn) => pawn.id !== excluded && pawn.zone === "track" && pawn.pos === position) || null; }
function sorrySafetyPawn(state, player, position, excluded = -1) { return state.pawns.find((pawn) => pawn.id !== excluded && pawn.player === player && pawn.zone === "safety" && pawn.pos === position) || null; }
function sorryDestination(state, pawn, direction, amount) {
  const color = sorryColor(state, pawn.player);
  if (pawn.zone === "home" || pawn.zone === "start") return null;
  if (direction === "backward") {
    if (pawn.zone === "track") return { zone: "track", pos: (pawn.pos - amount + 600) % 60 };
    if (amount <= pawn.pos) return { zone: "safety", pos: pawn.pos - amount };
    return { zone: "track", pos: (color.entry - (amount - pawn.pos - 1) + 600) % 60 };
  }
  if (pawn.zone === "safety") {
    const target = pawn.pos + amount;
    return target < 5 ? { zone: "safety", pos: target } : target === 5 ? { zone: "home", pos: 0 } : null;
  }
  const distance = (color.entry - pawn.pos + 60) % 60;
  if (amount <= distance) return { zone: "track", pos: (pawn.pos + amount) % 60 };
  const remaining = amount - distance - 1;
  return remaining < 5 ? { zone: "safety", pos: remaining } : remaining === 5 ? { zone: "home", pos: 0 } : null;
}
function sorryLanding(state, pawn, position) {
  const occupant = sorryTrackPawn(state, position, pawn.id);
  if (occupant && (occupant.player === pawn.player || sorryIced(state, occupant.id))) return null;
  const slide = SORRY_SLIDES.find((candidate) => candidate.start === position && candidate.owner !== sorryColor(state, pawn.player).key) || null;
  if (!slide) return { destination: { zone: "track", pos: position }, bumps: occupant ? [occupant.id] : [] };
  const end = sorryTrackPawn(state, slide.end, pawn.id);
  if (end && sorryIced(state, end.id)) return null;
  const bumps = [];
  for (const point of slide.path) {
    const hit = sorryTrackPawn(state, point, pawn.id);
    if (hit && !sorryIced(state, hit.id) && !bumps.includes(hit.id)) bumps.push(hit.id);
  }
  return { destination: { zone: "track", pos: slide.end }, bumps };
}
function sorryMovePlan(state, pawnId, direction, amount) {
  const pawn = sorryPawn(state, pawnId);
  if (!pawn || pawn.zone === "home" || sorryIced(state, pawn.id)) return null;
  let destination;
  if (direction === "start") {
    if (pawn.zone !== "start" || amount < 1) return null;
    const color = sorryColor(state, pawn.player), entered = { ...pawn, zone: "track", pos: color.start };
    destination = amount === 1 ? { zone: "track", pos: color.start } : sorryDestination(state, entered, "forward", amount - 1);
  } else {
    if (pawn.zone === "start") return null;
    destination = sorryDestination(state, pawn, direction, amount);
  }
  if (!destination) return null;
  if (destination.zone === "track") {
    const landing = sorryLanding(state, pawn, destination.pos);
    return landing ? { type: "move", pawnId, destination: landing.destination, bumps: landing.bumps } : null;
  }
  if (destination.zone === "safety" && sorrySafetyPawn(state, pawn.player, destination.pos, pawn.id)) return null;
  return { type: "move", pawnId, destination, bumps: [] };
}
function applySorryPlan(state, plan) {
  const next = clone(state);
  for (const id of plan.bumps || []) { next.pawns[id].zone = "start"; next.pawns[id].pos = 0; }
  if (plan.type === "move" || plan.type === "sorry") {
    next.pawns[plan.pawnId].zone = plan.destination.zone; next.pawns[plan.pawnId].pos = plan.destination.pos;
  } else if (plan.type === "switch") {
    const own = next.pawns[plan.ownId], target = next.pawns[plan.targetId];
    own.zone = plan.ownDestination.zone; own.pos = plan.ownDestination.pos;
    target.zone = "track"; target.pos = plan.targetPosition;
  }
  return next;
}
function sorryPlans(state, card, actor) {
  const plans = [], own = state.pawns.filter((pawn) => pawn.player === actor);
  const startAmount = ({ "1":1, "2":2, "3":3, "5":5, "7":7, "8":8, "10":10, "11":11, "12":12 })[card] || 0;
  if (startAmount) for (const pawn of own) { const plan = sorryMovePlan(state, pawn.id, "start", startAmount); if (plan) plans.push(plan); }
  const add = (direction, amount) => { for (const pawn of own) { const plan = sorryMovePlan(state, pawn.id, direction, amount); if (plan) plans.push(plan); } };
  if (["1","2","3","5","7","8","11","12"].includes(card)) add("forward", Number(card));
  if (card === "4") add("backward", 4);
  if (card === "10") { add("forward", 10); add("backward", 1); }
  if (card === "S") add("forward", 4);
  if (card === "11") {
    for (const mine of own.filter((pawn) => pawn.zone === "track" && !sorryIced(state, pawn.id))) for (const target of state.pawns.filter((pawn) => pawn.player !== actor && pawn.zone === "track" && !sorryIced(state, pawn.id))) {
      const copy = clone(state), old = copy.pawns[mine.id].pos, targetPosition = copy.pawns[target.id].pos;
      copy.pawns[target.id].pos = old;
      const landing = sorryLanding(copy, copy.pawns[mine.id], targetPosition);
      if (landing) plans.push({ type: "switch", ownId: mine.id, targetId: target.id, ownDestination: landing.destination, targetPosition: old, bumps: landing.bumps.filter((id) => id !== target.id) });
    }
  }
  if (card === "S") for (const mine of own.filter((pawn) => pawn.zone === "start" && !sorryIced(state, pawn.id))) for (const target of state.pawns.filter((pawn) => pawn.player !== actor && pawn.zone === "track" && !sorryIced(state, pawn.id))) {
    const copy = clone(state); copy.pawns[target.id].zone = "start"; copy.pawns[target.id].pos = 0;
    const landing = sorryLanding(copy, copy.pawns[mine.id], target.pos);
    if (landing) plans.push({ type: "sorry", pawnId: mine.id, destination: landing.destination, bumps: [target.id, ...landing.bumps.filter((id) => id !== target.id)] });
  }
  if (card === "7") {
    for (let firstAmount = 1; firstAmount <= 6; firstAmount++) for (const firstPawn of own.filter((pawn) => pawn.zone !== "start" && pawn.zone !== "home" && !sorryIced(state, pawn.id))) {
      const first = sorryMovePlan(state, firstPawn.id, "forward", firstAmount); if (!first) continue;
      const interim = applySorryPlan(state, first);
      for (const secondPawn of interim.pawns.filter((pawn) => pawn.player === actor && pawn.id !== firstPawn.id && pawn.zone !== "start" && pawn.zone !== "home" && !sorryIced(interim, pawn.id))) {
        const second = sorryMovePlan(interim, secondPawn.id, "forward", 7 - firstAmount); if (!second) continue;
        plans.push({ type: "split", first, second });
      }
    }
  }
  return plans;
}
function sorryOutcome(state, plan) {
  if (plan.type !== "split") return applySorryPlan(state, plan).pawns;
  return applySorryPlan(applySorryPlan(state, plan.first), plan.second).pawns;
}
function sorryCardCandidates(before) {
  if (before.currentCard && Object.hasOwn(SORRY_CARDS, before.currentCard)) return [before.currentCard];
  if (before.phase === "draw") return before.deck.length ? [before.deck[before.deck.length - 1]] : Object.keys(SORRY_CARDS);
  if (before.phase === "chooseCard") return Array.from(new Set(before.hands[before.turn] || []));
  return [];
}
function sorryCardWasConsumed(before, after, candidates) {
  if (after.winner !== null || after.phase === "firePull") return true;
  const discardAdded = after.discard.length === before.discard.length + 1 && candidates.includes(after.discard[after.discard.length - 1]);
  if (discardAdded) return true;
  // A depleted draw pile is reshuffled before drawing, so array order and the
  // discard length both change. Conservation was already checked by sorryInfo.
  return before.phase === "draw" && before.deck.length === 0 && after.discard.length <= 1 && after.deck.length >= 39;
}
function sorryFireJumpOutcome(before, after) {
  if (before.phase !== "preFire" || before.firePawnId === null) return false;
  const fire = before.pawns[before.firePawnId];
  if (!fire || fire.zone !== "track" || sorryIced(before, fire.id)) return false;
  let target = null;
  for (let distance = 1; distance <= 60; distance++) { const position = (fire.pos + distance) % 60; if ([0,15,30,45].includes(position)) { target = position; break; } }
  if (target === null || (sorryColor(before, fire.player).entry - fire.pos + 60) % 60 < (target - fire.pos + 60) % 60) return false;
  const landing = sorryLanding(before, fire, target); if (!landing) return false;
  const plan = { type: "move", pawnId: fire.id, destination: landing.destination, bumps: landing.bumps };
  return same(applySorryPlan(before, plan).pawns, after.pawns);
}

function sorryPawnTransition(before, after, actor) {
  const changed = before.pawns.map((pawn, index) => same(pawn, after.pawns[index]) ? null : { before: pawn, after: after.pawns[index] }).filter(Boolean);
  if (!changed.length) return;
  const own = changed.filter((item) => item.before.player === actor), opponents = changed.filter((item) => item.before.player !== actor);
  requireValue(own.length >= 1 && own.length <= 3 && opponents.length <= 8, "Too many Sorry pawns changed in one action");
  for (const item of opponents) requireValue(item.after.zone === "start" || (item.before.zone === "track" && item.after.zone === "track"), "A Sorry turn may only bump or switch an opponent pawn");
  const switches = opponents.filter((item) => item.after.zone === "track");
  requireValue(switches.length <= 1 && (!switches.length || own.some((item) => item.before.zone === "track" && item.after.zone === "track" && item.after.pos === switches[0].before.pos && switches[0].after.pos === item.before.pos)), "Invalid Sorry switch");
  const newlyHome = own.filter((item) => item.before.zone !== "home" && item.after.zone === "home");
  const activeMovers = own.filter((item) => item.after.zone !== "start");
  const leavingStart = own.filter((item) => item.before.zone === "start" && item.after.zone !== "start");
  requireValue(activeMovers.length <= 2 && leavingStart.length <= 1, "One Sorry card cannot advance that many pawns");
  for (const item of own) {
    requireValue(item.before.zone !== "home", "A Sorry pawn cannot leave Home");
    if (item.before.zone === "start" && item.after.zone === "home") {
      requireValue(before.phase === "firePull" && newlyHome.length === 1 && before.firePawnId !== null && before.pawns[before.firePawnId]?.zone === "home", "A Sorry pawn may only move directly from Start to Home through a pending Fire pull");
    }
    if (item.before.zone === "start" && item.after.zone !== "start" && item.after.zone !== "track" && item.after.zone !== "home") throw gameError("A Sorry pawn can only leave Start onto the track");
  }
  requireValue(newlyHome.length <= (before.phase === "firePull" ? 1 : 2), "Too many Sorry pawns entered Home in one action");
}

function validateSorryState(room, member, action) {
  const before = room.state, after = action.state, a = sorryInfo(before, room), b = sorryInfo(after, room), actor = before.players.findIndex((player) => player.seat === member.seat);
  requireValue(actor >= 0 && before.turn === actor && room.turn?.seat === member.seat, "Sorry actor does not own this turn");
  requireValue(same(before.players.map((player) => [player.id, player.seat, player.colorIndex]), after.players.map((player) => [player.id, player.seat, player.colorIndex])) && before.mode === after.mode, "Sorry player mapping cannot change during a game");
  requireValue(after.moveNo === before.moveNo || after.moveNo === before.moveNo + 1, "Sorry may resolve at most one card action per update");
  sorryPawnTransition(before, after, actor);
  const pawnsChanged = !same(before.pawns, after.pawns);
  if (pawnsChanged) {
    if (before.phase === "firePull" && after.moveNo === before.moveNo) {
      const changed = before.pawns.map((pawn, index) => same(pawn, after.pawns[index]) ? null : { before: pawn, after: after.pawns[index] }).filter(Boolean);
      requireValue(changed.length === 1 && changed[0].before.player === actor && changed[0].before.zone !== "home" && changed[0].after.zone === "home" && changed[0].before.id !== before.firePawnId && changed[0].before.id !== before.icePawnId, "Invalid Sorry Fire pull");
    } else if (after.moveNo === before.moveNo) {
      requireValue(sorryFireJumpOutcome(before, after), "A cardless Sorry pawn move is only legal for the active Fire jump");
    } else {
      const cards = sorryCardCandidates(before), base = clone(before);
      base.firePawnId = after.firePawnId; base.icePawnId = after.icePawnId;
      const legalOutcome = cards.some((card) => sorryPlans(base, card, actor).some((plan) => same(sorryOutcome(base, plan), after.pawns)));
      requireValue(legalOutcome, "Sorry pawn positions are not the result of one legal played card");
      requireValue(sorryCardWasConsumed(before, after, cards), "A Sorry pawn move must consume its played card");
    }
  }
  const expectedSeat = after.players[after.turn]?.seat;
  requireValue(memberAtSeat(room, expectedSeat) && Number(action.nextSeat ?? member.seat) === expectedSeat, "Invalid Sorry next player");
  const finished = b.winner !== null;
  expectedFinish(action, finished);
  if (finished) {
    const winner = after.players[b.winner];
    const homesBefore = before.pawns.filter((pawn) => pawn.player === b.winner && pawn.zone === "home").length;
    requireValue(homesBefore >= 1, "A Sorry player cannot move every pawn Home in one action");
    requireValue(same(action.result, { winnerSeat: winner.seat, winnerName: winner.name, reason: "home" }), "Invalid Sorry winner");
  } else requireValue(!Object.hasOwn(action, "result"), "Sorry result supplied before completion");
  if (pawnsChanged && after.moveNo === before.moveNo + 1 && after.phase !== "firePull" && !finished) {
    requireValue(expectedSeat === nextSeat(room, member.seat), "A completed Sorry card must pass to the next occupied seat");
  }
  if (pawnsChanged && after.moveNo === before.moveNo && before.phase !== "firePull") requireValue(expectedSeat === member.seat, "A Sorry Fire jump retains the current seat");
  requireValue(a.winner === null, "A completed Sorry game cannot accept another action");
}

function monopolyInfo(state, room) {
  requireValue(object(state) && state.version === 1 && Array.isArray(state.players) && integer(state.players.length, 2, 6) && object(state.deeds) && integer(state.turnIndex, 0, state.players.length - 1), "Invalid Monopoly state");
  const ids = new Set();
  for (const player of state.players) {
    requireValue(object(player) && integer(player.id, 0, room.maxPlayers - 1) && !ids.has(player.id) && typeof player.name === "string" && player.name.length <= 24 && Number.isFinite(player.cash) && player.cash >= 0 && player.cash <= 1e9 && integer(player.pos, 0, 39), "Invalid Monopoly player ledger");
    ids.add(player.id);
  }
  let houses = 0, hotels = 0;
  for (const [idText] of Object.entries(MONOPOLY_PROPERTY)) {
    const deed = state.deeds[idText];
    requireValue(object(deed) && (deed.owner === null || ids.has(deed.owner)) && typeof deed.mortgaged === "boolean" && integer(deed.houses, 0, 5), "Invalid Monopoly deed ledger");
    requireValue(!(deed.mortgaged && deed.houses), "A mortgaged Monopoly deed cannot have buildings");
    if (deed.houses === 5) hotels++; else houses += deed.houses;
  }
  requireValue(object(state.bank) && integer(state.bank.houses, 0, 32) && integer(state.bank.hotels, 0, 12) && state.bank.houses + houses === 32 && state.bank.hotels + hotels === 12, "Monopoly building inventory is not conserved");
  requireValue(["roll", "offer", "end", "debt", "auction", "cardDraw", "moving", "gameOver"].includes(state.phase) && integer(state.turnCount, 0, 1000000) && integer(state.round, 1, 1000000), "Invalid Monopoly phase or counters");
  requireValue(typeof state.gameOver === "boolean" && (!state.gameOver || state.phase === "gameOver"), "Invalid Monopoly game-over state");
  return { ids };
}

function monopolyActorSeat(state) {
  const queued = state.pendingMortgageChoices?.[0]?.playerId;
  if (Number.isInteger(queued)) return queued;
  if (Number.isInteger(state.pendingTrade?.toId)) return state.pendingTrade.toId;
  if (state.phase === "auction" && Number.isInteger(state.pendingAuction?.currentBidderId)) return state.pendingAuction.currentBidderId;
  if (state.phase === "debt" && Number.isInteger(state.pendingDebt?.debtorId)) return state.pendingDebt.debtorId;
  return state.players[state.turnIndex]?.id ?? null;
}

function monopolyWorth(state, player) {
  if (!player || player.bankrupt) return 0;
  const threshold = state.settings?.quickHotels ? 3 : 4;
  let worth = Number(player.cash) || 0;
  for (const [idText, [price, mortgage, build]] of Object.entries(MONOPOLY_PROPERTY)) {
    const deed = state.deeds[idText]; if (deed.owner !== player.id) continue;
    worth += deed.mortgaged ? mortgage : price;
    if (build && deed.houses) worth += build * (deed.houses === 5 ? threshold + 1 : deed.houses);
  }
  return Math.round(worth);
}

function monopolyEconomicValue(state) {
  let value = state.players.reduce((sum, player) => sum + (Number(player.cash) || 0), 0);
  const threshold = state.settings?.quickHotels ? 3 : 4;
  for (const [idText, [price, , build]] of Object.entries(MONOPOLY_PROPERTY)) {
    const deed = state.deeds[idText];
    if (deed.owner === null) continue;
    value += price;
    if (build && deed.houses) value += build * (deed.houses === 5 ? threshold + 1 : deed.houses);
  }
  return value;
}

function monopolyLiquidationCapacity(state, player) {
  if (!player) return 0;
  const threshold = state.settings?.quickHotels ? 3 : 4;
  let capacity = Number(player.cash) || 0;
  for (const [idText, [, mortgage, build]] of Object.entries(MONOPOLY_PROPERTY)) {
    const deed = state.deeds[idText]; if (deed.owner !== player.id) continue;
    if (!deed.mortgaged) capacity += mortgage;
    if (build && deed.houses) capacity += Math.floor(build * (deed.houses === 5 ? threshold + 1 : deed.houses) / 2);
  }
  return capacity;
}

function validateMonopolyStart(room, action) {
  const state = action.state; monopolyInfo(state, room);
  const members = activeMembers(room);
  requireValue(same(state.players.map((player) => player.id), members.map((member) => member.seat)) && state.turnIndex === 0 && state.phase === "roll" && state.turnCount === 0 && !state.gameOver, "Invalid initial Monopoly table");
  requireValue(Number(action.firstSeat ?? members[0].seat) === members[0].seat, "Monopoly must start with its first occupied seat");
}

function validateMonopolyState(room, member, action) {
  const before = room.state, after = action.state; monopolyInfo(before, room); monopolyInfo(after, room);
  requireValue(monopolyActorSeat(before) === member.seat && room.turn?.seat === member.seat, "Monopoly actor does not own this decision");
  requireValue(same(before.players.map((player) => player.id), after.players.map((player) => player.id)), "Monopoly seats cannot change through a game action");
  requireValue(after.turnCount >= before.turnCount && after.turnCount <= before.turnCount + 1 && after.round >= before.round && after.round <= before.round + 1, "Monopoly turn counters changed impossibly");
  const beforeCash = before.players.reduce((sum, player) => sum + Number(player.cash || 0), 0), afterCash = after.players.reduce((sum, player) => sum + Number(player.cash || 0), 0);
  requireValue(afterCash <= beforeCash + 10000 && monopolyEconomicValue(after) <= monopolyEconomicValue(before) + 10000, "Monopoly value changed beyond one legal action");
  const ownerChanges = Object.keys(MONOPOLY_PROPERTY).filter((id) => before.deeds[id]?.owner !== after.deeds[id]?.owner);
  const bulkTransferContext = Boolean(before.pendingTrade || before.pendingAuction || before.pendingDebt || before.bankruptcyStack?.length);
  requireValue(ownerChanges.length <= 1 || bulkTransferContext, "Multiple Monopoly deeds cannot change owner without a trade, auction, or bankruptcy");
  const newlyBankrupt = after.players.filter((player) => player.bankrupt && !before.players.find((candidate) => candidate.id === player.id)?.bankrupt);
  requireValue(newlyBankrupt.length <= 1, "Only one Monopoly player can declare bankruptcy in one action");
  if (newlyBankrupt.length) {
    const debtor = before.players.find((player) => player.id === newlyBankrupt[0].id), debt = before.pendingDebt;
    requireValue(debt?.debtorId === debtor?.id && Number(debt.amount) > monopolyLiquidationCapacity(before, debtor), "A Monopoly player may only become bankrupt from an unpayable pending debt");
  }
  const actor = monopolyActorSeat(after);
  requireValue(memberAtSeat(room, actor) && Number(action.nextSeat ?? actor) === actor, "Invalid Monopoly decision owner");
  expectedFinish(action, after.gameOver);
  if (after.gameOver) {
    const active = after.players.filter((player) => !player.bankrupt).length;
    const firstBankruptcy = Boolean(after.settings?.firstBankruptcy && newlyBankrupt.length);
    const turnLimit = Number(after.settings?.turnLimit || 0);
    requireValue(active <= 1 || firstBankruptcy || (turnLimit > 0 && after.turnCount >= turnLimit), "Monopoly cannot finish before an end condition");
    const ranked = after.players.slice().sort((left, right) => monopolyWorth(after, right) - monopolyWorth(after, left));
    requireValue(object(action.result) && action.result.winnerSeat === ranked[0]?.id && action.result.reason === (after.endReason || "Game over"), "Invalid Monopoly winner");
  } else requireValue(!Object.hasOwn(action, "result"), "Monopoly result supplied before completion");
}

const START_VALIDATORS = Object.freeze({ memory: validateMemoryStart, "tic-tac-toe": validateTicTacToeStart, dots: validateDotsStart, checkers: validateCheckersStart, sorry: validateAuthoritativeSorryStart, monopoly: validateAuthoritativeMonopolyStart });
const STATE_VALIDATORS = Object.freeze({ memory: validateMemoryState, "tic-tac-toe": validateTicTacToeState, dots: validateDotsState, checkers: validateCheckersState, sorry: validateSorryTransition, monopoly: validateMonopolyTransition });

export function authorityForGenericGame(game) {
  return GENERIC_GAME_AUTHORITY[game] || null;
}

export function validateGenericGameAction(roomValue, memberValue, actionValue) {
  const room = roomValue, member = memberValue, action = actionValue;
  requireValue(object(room) && object(member) && object(action), "Invalid authoritative game action");
  const authority = authorityForGenericGame(room.game);
  requireValue(authority, "Unsupported authoritative game");
  if (room.game === "chat" || action.type === "chat" || action.type === "leave") return authority;
  if (action.type === "start" || action.type === "restart") {
    requireValue(Object.hasOwn(action, "state"), `${room.game} start requires a state snapshot`);
    START_VALIDATORS[room.game](room, action);
  } else if (action.type === "state") {
    requireValue(Object.hasOwn(action, "state"), `${room.game} action requires a state snapshot`);
    STATE_VALIDATORS[room.game](room, member, action);
  }
  return authority;
}

export const __test = Object.freeze({
  tttInfo,
  dotsInfo,
  checkersInfo,
  memoryInfo,
  sorryInfo,
  monopolyInfo,
  monopolyWorth: authoritativeMonopolyWorth
});
