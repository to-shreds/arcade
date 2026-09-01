const FILES = "abcdefgh";
const PROMOTIONS = "qrbn";

export function squareToIndex(square) {
  if (typeof square !== "string" || !/^[a-h][1-8]$/.test(square)) return -1;
  return FILES.indexOf(square[0]) + (Number(square[1]) - 1) * 8;
}

export function indexToSquare(index) {
  if (!Number.isInteger(index) || index < 0 || index > 63) return null;
  return FILES[index & 7] + String((index >> 3) + 1);
}

const fileOf = (sq) => sq & 7;
const rankOf = (sq) => sq >> 3;
const colorOf = (piece) => piece && piece === piece.toUpperCase() ? "w" : piece ? "b" : null;
const typeOf = (piece) => piece ? piece.toLowerCase() : null;
const opposite = (color) => color === "w" ? "b" : "w";

function clonePosition(position) {
  return {
    board: position.board.slice(),
    turn: position.turn,
    castling: position.castling,
    ep: position.ep,
    halfmove: position.halfmove,
    fullmove: position.fullmove
  };
}

export function fromFen(fen) {
  if (typeof fen !== "string") throw new Error("FEN must be a string");
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4) throw new Error("Incomplete FEN");
  const ranks = fields[0].split("/");
  if (ranks.length !== 8) throw new Error("FEN must contain eight ranks");
  const board = Array(64).fill(null);
  let whiteKings = 0;
  let blackKings = 0;
  for (let fenRank = 0; fenRank < 8; fenRank++) {
    let file = 0;
    for (const symbol of ranks[fenRank]) {
      if (/^[1-8]$/.test(symbol)) {
        file += Number(symbol);
      } else if (/^[prnbqkPRNBQK]$/.test(symbol)) {
        if (file > 7) throw new Error("FEN rank is too long");
        const sq = (7 - fenRank) * 8 + file;
        board[sq] = symbol;
        if (symbol === "K") whiteKings++;
        if (symbol === "k") blackKings++;
        file++;
      } else {
        throw new Error("Invalid FEN piece");
      }
    }
    if (file !== 8) throw new Error("FEN rank is not eight squares");
  }
  if (whiteKings !== 1 || blackKings !== 1) throw new Error("FEN must contain one king per side");
  if (!/^[wb]$/.test(fields[1])) throw new Error("Invalid side to move");
  const castling = fields[2] === "-" ? "" : fields[2];
  if (!/^(?!.*(.).*\1)[KQkq]*$/.test(castling)) throw new Error("Invalid castling rights");
  const ep = fields[3] === "-" ? -1 : squareToIndex(fields[3]);
  if (fields[3] !== "-" && ep < 0) throw new Error("Invalid en passant square");
  const halfmove = fields[4] === undefined ? 0 : Number(fields[4]);
  const fullmove = fields[5] === undefined ? 1 : Number(fields[5]);
  if (!Number.isInteger(halfmove) || halfmove < 0 || !Number.isInteger(fullmove) || fullmove < 1) {
    throw new Error("Invalid move counters");
  }
  return { board, turn: fields[1], castling, ep, halfmove, fullmove };
}

export function toFen(position) {
  const rows = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = position.board[rank * 8 + file];
      if (!piece) empty++;
      else {
        if (empty) row += String(empty);
        empty = 0;
        row += piece;
      }
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  return `${rows.join("/")} ${position.turn} ${position.castling || "-"} ${position.ep < 0 ? "-" : indexToSquare(position.ep)} ${position.halfmove} ${position.fullmove}`;
}

export function initialPosition() {
  return fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
}

function findKing(position, color) {
  return position.board.indexOf(color === "w" ? "K" : "k");
}

export function isSquareAttacked(position, square, byColor) {
  const board = position.board;
  const f0 = fileOf(square);
  const r0 = rankOf(square);
  const pawn = byColor === "w" ? "P" : "p";
  const pawnRank = r0 + (byColor === "w" ? -1 : 1);
  if (pawnRank >= 0 && pawnRank < 8) {
    for (const df of [-1, 1]) {
      const file = f0 + df;
      if (file >= 0 && file < 8 && board[pawnRank * 8 + file] === pawn) return true;
    }
  }
  const knight = byColor === "w" ? "N" : "n";
  for (const [df, dr] of [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]]) {
    const f = f0 + df;
    const r = r0 + dr;
    if (f >= 0 && f < 8 && r >= 0 && r < 8 && board[r * 8 + f] === knight) return true;
  }
  const king = byColor === "w" ? "K" : "k";
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    if (!df && !dr) continue;
    const f = f0 + df;
    const r = r0 + dr;
    if (f >= 0 && f < 8 && r >= 0 && r < 8 && board[r * 8 + f] === king) return true;
  }
  const bishop = byColor === "w" ? "B" : "b";
  const rook = byColor === "w" ? "R" : "r";
  const queen = byColor === "w" ? "Q" : "q";
  for (const [df, dr, attackers] of [
    [1,1,[bishop,queen]], [1,-1,[bishop,queen]], [-1,1,[bishop,queen]], [-1,-1,[bishop,queen]],
    [1,0,[rook,queen]], [-1,0,[rook,queen]], [0,1,[rook,queen]], [0,-1,[rook,queen]]
  ]) {
    let f = f0 + df;
    let r = r0 + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const piece = board[r * 8 + f];
      if (piece) {
        if (attackers.includes(piece)) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }
  return false;
}

export function isInCheck(position, color = position.turn) {
  const king = findKing(position, color);
  if (king < 0) throw new Error("Position has no king");
  return isSquareAttacked(position, king, opposite(color));
}

function addMove(list, position, from, to, extra = {}) {
  const target = position.board[to];
  if (target && typeOf(target) === "k") return;
  list.push({ from, to, promotion: null, capture: target || null, ...extra });
}

function pseudoMoves(position) {
  const list = [];
  const board = position.board;
  const us = position.turn;
  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || colorOf(piece) !== us) continue;
    const type = typeOf(piece);
    const f0 = fileOf(from);
    const r0 = rankOf(from);
    if (type === "p") {
      const dir = us === "w" ? 1 : -1;
      const startRank = us === "w" ? 1 : 6;
      const promoRank = us === "w" ? 7 : 0;
      const oneRank = r0 + dir;
      if (oneRank >= 0 && oneRank < 8) {
        const one = oneRank * 8 + f0;
        if (!board[one]) {
          if (oneRank === promoRank) for (const promotion of PROMOTIONS) addMove(list, position, from, one, { promotion });
          else addMove(list, position, from, one);
          const two = (r0 + dir * 2) * 8 + f0;
          if (r0 === startRank && !board[two]) addMove(list, position, from, two, { doublePawn: true });
        }
        for (const df of [-1, 1]) {
          const f = f0 + df;
          if (f < 0 || f > 7) continue;
          const to = oneRank * 8 + f;
          const target = board[to];
          if (target && colorOf(target) !== us && typeOf(target) !== "k") {
            if (oneRank === promoRank) for (const promotion of PROMOTIONS) addMove(list, position, from, to, { promotion });
            else addMove(list, position, from, to);
          } else if (to === position.ep) {
            const capturedSquare = to + (us === "w" ? -8 : 8);
            const expected = us === "w" ? "p" : "P";
            if (board[capturedSquare] === expected) addMove(list, position, from, to, { enPassant: true, capture: expected });
          }
        }
      }
    } else if (type === "n") {
      for (const [df, dr] of [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]]) {
        const f = f0 + df;
        const r = r0 + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const to = r * 8 + f;
        if (!board[to] || (colorOf(board[to]) !== us && typeOf(board[to]) !== "k")) addMove(list, position, from, to);
      }
    } else if (type === "b" || type === "r" || type === "q") {
      const dirs = [];
      if (type === "b" || type === "q") dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
      if (type === "r" || type === "q") dirs.push([1,0],[-1,0],[0,1],[0,-1]);
      for (const [df, dr] of dirs) {
        let f = f0 + df;
        let r = r0 + dr;
        while (f >= 0 && f < 8 && r >= 0 && r < 8) {
          const to = r * 8 + f;
          if (!board[to]) addMove(list, position, from, to);
          else {
            if (colorOf(board[to]) !== us && typeOf(board[to]) !== "k") addMove(list, position, from, to);
            break;
          }
          f += df;
          r += dr;
        }
      }
    } else if (type === "k") {
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
        if (!df && !dr) continue;
        const f = f0 + df;
        const r = r0 + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const to = r * 8 + f;
        if (!board[to] || (colorOf(board[to]) !== us && typeOf(board[to]) !== "k")) addMove(list, position, from, to);
      }
      const enemy = opposite(us);
      if (!isInCheck(position, us)) {
        if (us === "w" && from === 4) {
          if (position.castling.includes("K") && board[7] === "R" && !board[5] && !board[6] && !isSquareAttacked(position,5,enemy) && !isSquareAttacked(position,6,enemy)) addMove(list,position,4,6,{castle:"K"});
          if (position.castling.includes("Q") && board[0] === "R" && !board[1] && !board[2] && !board[3] && !isSquareAttacked(position,3,enemy) && !isSquareAttacked(position,2,enemy)) addMove(list,position,4,2,{castle:"Q"});
        } else if (us === "b" && from === 60) {
          if (position.castling.includes("k") && board[63] === "r" && !board[61] && !board[62] && !isSquareAttacked(position,61,enemy) && !isSquareAttacked(position,62,enemy)) addMove(list,position,60,62,{castle:"k"});
          if (position.castling.includes("q") && board[56] === "r" && !board[57] && !board[58] && !board[59] && !isSquareAttacked(position,59,enemy) && !isSquareAttacked(position,58,enemy)) addMove(list,position,60,58,{castle:"q"});
        }
      }
    }
  }
  return list;
}

function removeCastling(rights, chars) {
  for (const char of chars) rights = rights.replace(char, "");
  return rights;
}

export function applyUnchecked(position, move) {
  const next = clonePosition(position);
  const board = next.board;
  const piece = board[move.from];
  const us = colorOf(piece);
  const target = board[move.to];
  board[move.from] = null;
  board[move.to] = move.promotion ? (us === "w" ? move.promotion.toUpperCase() : move.promotion) : piece;
  if (move.enPassant) board[move.to + (us === "w" ? -8 : 8)] = null;
  if (move.castle === "K") { board[7] = null; board[5] = "R"; }
  if (move.castle === "Q") { board[0] = null; board[3] = "R"; }
  if (move.castle === "k") { board[63] = null; board[61] = "r"; }
  if (move.castle === "q") { board[56] = null; board[59] = "r"; }
  if (piece === "K") next.castling = removeCastling(next.castling, "KQ");
  if (piece === "k") next.castling = removeCastling(next.castling, "kq");
  if (move.from === 0 || move.to === 0) next.castling = removeCastling(next.castling, "Q");
  if (move.from === 7 || move.to === 7) next.castling = removeCastling(next.castling, "K");
  if (move.from === 56 || move.to === 56) next.castling = removeCastling(next.castling, "q");
  if (move.from === 63 || move.to === 63) next.castling = removeCastling(next.castling, "k");
  next.ep = move.doublePawn ? move.from + (us === "w" ? 8 : -8) : -1;
  next.halfmove = typeOf(piece) === "p" || target || move.enPassant ? 0 : next.halfmove + 1;
  if (us === "b") next.fullmove++;
  next.turn = opposite(us);
  return next;
}

export function legalMoves(position) {
  const us = position.turn;
  return pseudoMoves(position).filter((move) => !isInCheck(applyUnchecked(position, move), us));
}

export function moveToUci(move) {
  return indexToSquare(move.from) + indexToSquare(move.to) + (move.promotion || "");
}

function normalizeUci(uci) {
  return typeof uci === "string" ? uci.trim().toLowerCase() : "";
}

function sanForMove(position, move, allLegal) {
  const piece = position.board[move.from];
  const type = typeOf(piece);
  if (move.castle) return (move.to > move.from ? "O-O" : "O-O-O") + checkSuffix(position, move);
  const capture = Boolean(move.capture || move.enPassant);
  let san = "";
  if (type !== "p") {
    san += type.toUpperCase();
    const peers = allLegal.filter((other) => other !== move && other.to === move.to && position.board[other.from] === piece);
    if (peers.length) {
      const sameFile = peers.some((other) => fileOf(other.from) === fileOf(move.from));
      const sameRank = peers.some((other) => rankOf(other.from) === rankOf(move.from));
      if (!sameFile) san += FILES[fileOf(move.from)];
      else if (!sameRank) san += String(rankOf(move.from) + 1);
      else san += indexToSquare(move.from);
    }
  } else if (capture) san += FILES[fileOf(move.from)];
  if (capture) san += "x";
  san += indexToSquare(move.to);
  if (move.promotion) san += "=" + move.promotion.toUpperCase();
  return san + checkSuffix(position, move);
}

function checkSuffix(position, move) {
  const next = applyUnchecked(position, move);
  if (!isInCheck(next, next.turn)) return "";
  return legalMoves(next).length ? "+" : "#";
}

function hasLegalEnPassant(position) {
  if (position.ep < 0) return false;
  return pseudoMoves(position).some((move) => move.enPassant && !isInCheck(applyUnchecked(position, move), position.turn));
}

export function positionKey(position) {
  const board = position.board.map((piece) => piece || ".").join("");
  const ep = hasLegalEnPassant(position) ? indexToSquare(position.ep) : "-";
  return `${board} ${position.turn} ${position.castling || "-"} ${ep}`;
}

export function insufficientMaterial(position) {
  const pieces = [];
  for (let sq = 0; sq < 64; sq++) {
    const piece = position.board[sq];
    if (!piece || typeOf(piece) === "k") continue;
    const type = typeOf(piece);
    if (type === "p" || type === "r" || type === "q") return false;
    pieces.push({ type, color: (fileOf(sq) + rankOf(sq)) & 1 });
  }
  if (pieces.length === 0) return true;
  if (pieces.length === 1) return true;
  return pieces.every((piece) => piece.type === "b") && pieces.every((piece) => piece.color === pieces[0].color);
}

function evaluate(position, keys) {
  const legal = legalMoves(position);
  const check = isInCheck(position, position.turn);
  if (legal.length === 0) {
    if (check) return { over: true, reason: "checkmate", winner: opposite(position.turn), check };
    return { over: true, reason: "stalemate", winner: null, check };
  }
  if (insufficientMaterial(position)) return { over: true, reason: "insufficient-material", winner: null, check };
  if (position.halfmove >= 100) return { over: true, reason: "fifty-move", winner: null, check };
  const currentKey = positionKey(position);
  if (keys.filter((key) => key === currentKey).length >= 3) return { over: true, reason: "threefold-repetition", winner: null, check };
  return { over: false, reason: null, winner: null, check };
}

export function createGame(fen = null) {
  const position = fen ? fromFen(fen) : initialPosition();
  const initialFen = toFen(position);
  const keys = [positionKey(position)];
  return { initialFen, position, moves: [], positionKeys: keys, result: evaluate(position, keys) };
}

export function applyGameMove(game, uci) {
  if (game.result?.over) throw new Error("Game is already over");
  const wanted = normalizeUci(uci);
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(wanted)) throw new Error("Invalid move format");
  const allLegal = legalMoves(game.position);
  const move = allLegal.find((candidate) => moveToUci(candidate) === wanted);
  if (!move) throw new Error("Illegal move");
  const san = sanForMove(game.position, move, allLegal);
  const position = applyUnchecked(game.position, move);
  const positionKeys = game.positionKeys.concat(positionKey(position));
  const moves = game.moves.concat({ uci: wanted, san, from: indexToSquare(move.from), to: indexToSquare(move.to), promotion: move.promotion || null });
  return { ...game, position, positionKeys, moves, result: evaluate(position, positionKeys) };
}

export function undoLastMove(game) {
  if (!game.moves.length) throw new Error("No move to undo");
  let rebuilt = createGame(game.initialFen);
  for (const move of game.moves.slice(0, -1)) rebuilt = applyGameMove(rebuilt, move.uci);
  return rebuilt;
}

export function forceDraw(game, reason = "agreement") {
  return { ...game, result: { over: true, reason, winner: null, check: isInCheck(game.position, game.position.turn) } };
}

export function forceResign(game, side) {
  if (game.result?.over) throw new Error("Game is already over");
  return { ...game, result: { over: true, reason: "resignation", winner: opposite(side), check: isInCheck(game.position, game.position.turn) } };
}

export function publicGame(game) {
  return {
    board: game.position.board,
    turn: game.position.turn,
    castling: game.position.castling,
    enPassant: game.position.ep < 0 ? null : indexToSquare(game.position.ep),
    halfmove: game.position.halfmove,
    fullmove: game.position.fullmove,
    moves: game.moves,
    result: game.result
  };
}

export function perft(position, depth) {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const move of legalMoves(position)) nodes += perft(applyUnchecked(position, move), depth - 1);
  return nodes;
}
