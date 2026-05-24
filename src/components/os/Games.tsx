"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import * as Icons from "lucide-react";

// Shared focus guard for global keydown listeners. Returns true when the
// event target is an editable surface, so games never hijack typing.
function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return false;
}

// ============ SNAKE ============
const SNAKE_GRID = 16;
const SNAKE_TICK_MS = 130;
type Dir = "U" | "D" | "L" | "R";

export function SnakeGame() {
  const [snake, setSnake] = useState<Array<[number, number]>>([[8, 8], [8, 7], [8, 6]]);
  const [dir, setDir] = useState<Dir>("R");
  const [food, setFood] = useState<[number, number]>([4, 10]);
  const [alive, setAlive] = useState(true);
  const [score, setScore] = useState(0);
  const [high, setHigh] = useState(0);
  const dirRef = useRef(dir);
  dirRef.current = dir;

  useEffect(() => {
    try { setHigh(Number(localStorage.getItem("delos.snake.high") ?? 0)); } catch {}
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Focus guard — never hijack keys while user is typing in any input/textarea.
      // Catastrophic chat-input garbling bug surfaced during QA otherwise.
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if ((k === "w" || k === "arrowup") && dirRef.current !== "D") setDir("U");
      if ((k === "s" || k === "arrowdown") && dirRef.current !== "U") setDir("D");
      if ((k === "a" || k === "arrowleft") && dirRef.current !== "R") setDir("L");
      if ((k === "d" || k === "arrowright") && dirRef.current !== "L") setDir("R");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!alive) return;
    const t = setInterval(() => {
      setSnake((prev) => {
        const head = prev[0];
        const [dy, dx] = dirRef.current === "U" ? [-1, 0] : dirRef.current === "D" ? [1, 0] : dirRef.current === "L" ? [0, -1] : [0, 1];
        const next: [number, number] = [head[0] + dy, head[1] + dx];
        if (next[0] < 0 || next[0] >= SNAKE_GRID || next[1] < 0 || next[1] >= SNAKE_GRID) {
          setAlive(false);
          return prev;
        }
        if (prev.some(([y, x]) => y === next[0] && x === next[1])) {
          setAlive(false);
          return prev;
        }
        const ate = next[0] === food[0] && next[1] === food[1];
        const newSnake = ate ? [next, ...prev] : [next, ...prev.slice(0, -1)];
        if (ate) {
          setScore((s) => {
            const ns = s + 1;
            setHigh((h) => {
              const nh = Math.max(h, ns);
              try { localStorage.setItem("delos.snake.high", String(nh)); } catch {}
              return nh;
            });
            return ns;
          });
          let nf: [number, number];
          do {
            nf = [Math.floor(Math.random() * SNAKE_GRID), Math.floor(Math.random() * SNAKE_GRID)];
          } while (newSnake.some(([y, x]) => y === nf[0] && x === nf[1]));
          setFood(nf);
        }
        return newSnake;
      });
    }, SNAKE_TICK_MS);
    return () => clearInterval(t);
  }, [alive, food]);

  function reset() {
    setSnake([[8, 8], [8, 7], [8, 6]]);
    setDir("R");
    setFood([4, 10]);
    setAlive(true);
    setScore(0);
  }

  return (
    <div className="p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ SNAKE</div>
        <div className="flex gap-1">
          <span className="pill pill-info">{score}</span>
          <span className="pill pill-muted">HI {high}</span>
        </div>
      </div>
      <div className="grid mx-auto" style={{ gridTemplateColumns: `repeat(${SNAKE_GRID}, 1fr)`, width: 320, aspectRatio: "1 / 1", background: "var(--bg)", border: "2px solid var(--surface-2)" }}>
        {Array.from({ length: SNAKE_GRID * SNAKE_GRID }).map((_, i) => {
          const y = Math.floor(i / SNAKE_GRID);
          const x = i % SNAKE_GRID;
          const isHead = snake[0][0] === y && snake[0][1] === x;
          const isBody = !isHead && snake.some(([sy, sx]) => sy === y && sx === x);
          const isFood = food[0] === y && food[1] === x;
          return (
            <div
              key={i}
              style={{
                background: isHead ? "var(--accent)" : isBody ? "var(--success)" : isFood ? "var(--danger)" : "transparent",
                border: isFood ? "1px solid var(--accent)" : undefined,
              }}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-[color:var(--muted)] flex-1">WASD or arrows. Click area first to focus.</span>
        <button
          onClick={() => { try { localStorage.removeItem("delos.snake.high"); } catch {} setHigh(0); }}
          className="pill pill-muted"
          style={{ fontSize: 9, cursor: "pointer" }}
          title="Clear high score"
        >
          CLEAR
        </button>
        {!alive && <button onClick={reset} className="btn-pixel danger" style={{ padding: "4px 8px", fontSize: 10 }}>GAME OVER · RESET</button>}
      </div>
    </div>
  );
}

// ============ TIC-TAC-TOE ============
type Cell = "X" | "O" | null;

function checkWin(b: Cell[]): Cell {
  const L = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  for (const [a, b1, c] of L) {
    if (b[a] && b[a] === b[b1] && b[a] === b[c]) return b[a];
  }
  return null;
}

function aiMove(board: Cell[]): number {
  // 1. Win if possible
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      const t = [...board]; t[i] = "O";
      if (checkWin(t) === "O") return i;
    }
  }
  // 2. Block opponent win
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      const t = [...board]; t[i] = "X";
      if (checkWin(t) === "X") return i;
    }
  }
  // 3. Center
  if (!board[4]) return 4;
  // 4. Corner
  const corners = [0, 2, 6, 8].filter((i) => !board[i]);
  if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
  // 5. Side
  const sides = [1, 3, 5, 7].filter((i) => !board[i]);
  return sides[Math.floor(Math.random() * sides.length)];
}

export function TicTacToeGame() {
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const [turn, setTurn] = useState<"X" | "O">("X");
  const winner = checkWin(board);
  const filled = board.every((c) => c !== null);

  useEffect(() => {
    if (turn === "O" && !winner && !filled) {
      const t = setTimeout(() => {
        const i = aiMove(board);
        if (i !== undefined && !board[i]) {
          const next = [...board];
          next[i] = "O";
          setBoard(next);
          setTurn("X");
        }
      }, 350);
      return () => clearTimeout(t);
    }
  }, [turn, board, winner, filled]);

  function click(i: number) {
    if (board[i] || winner || turn !== "X") return;
    const next = [...board];
    next[i] = "X";
    setBoard(next);
    setTurn("O");
  }
  function reset() {
    setBoard(Array(9).fill(null));
    setTurn("X");
  }

  const status = winner === "X" ? "YOU WIN!" : winner === "O" ? "AI WINS" : filled ? "TIE" : turn === "X" ? "YOUR TURN" : "AI THINKING…";

  return (
    <div className="p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ TIC-TAC-TOE</div>
        <span className={`pill ${winner === "X" ? "pill-ok" : winner === "O" ? "pill-bad" : "pill-info"}`}>{status}</span>
      </div>
      <div className="grid grid-cols-3 gap-1 mx-auto" style={{ width: 200, height: 200 }}>
        {board.map((c, i) => (
          <button
            key={i}
            onClick={() => click(i)}
            className="card-pixel flex items-center justify-center"
            style={{
              padding: 0,
              cursor: winner || c ? "default" : "pointer",
              borderColor: c === "X" ? "var(--accent)" : c === "O" ? "var(--danger)" : "var(--surface-2)",
            }}
          >
            <span className="font-pixel text-3xl" style={{ color: c === "X" ? "var(--accent)" : "var(--danger)" }}>{c ?? ""}</span>
          </button>
        ))}
      </div>
      <div className="flex justify-center">
        <button onClick={reset} className="btn-pixel ghost" style={{ padding: "6px 10px", fontSize: 11 }}>RESET</button>
      </div>
    </div>
  );
}

// ============ MEMORY MATCH ============
const EMOJIS = ["★", "♥", "♦", "♠", "♣", "✦", "♪", "✿"];

type Card = { id: number; sym: string; matched: boolean; revealed: boolean };

function shuffle<T>(a: T[]): T[] {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

export function MemoryMatchGame() {
  const [cards, setCards] = useState<Card[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);

  const reset = useCallback(() => {
    const syms = shuffle([...EMOJIS, ...EMOJIS]);
    setCards(syms.map((s, i) => ({ id: i, sym: s, matched: false, revealed: false })));
    setSelected([]);
    setMoves(0);
  }, []);

  useEffect(() => { reset(); }, [reset]);

  useEffect(() => {
    if (selected.length !== 2) return;
    const [a, b] = selected;
    const ca = cards[a];
    const cb = cards[b];
    if (!ca || !cb) return;
    setMoves((m) => m + 1);
    if (ca.sym === cb.sym) {
      const next = [...cards];
      next[a].matched = true;
      next[b].matched = true;
      setCards(next);
      setSelected([]);
    } else {
      const t = setTimeout(() => {
        const next = [...cards];
        next[a].revealed = false;
        next[b].revealed = false;
        setCards(next);
        setSelected([]);
      }, 700);
      return () => clearTimeout(t);
    }
  }, [selected, cards]);

  function flip(i: number) {
    if (cards[i].revealed || cards[i].matched || selected.length === 2) return;
    const next = [...cards];
    next[i].revealed = true;
    setCards(next);
    setSelected((s) => [...s, i]);
  }

  const done = cards.length > 0 && cards.every((c) => c.matched);

  return (
    <div className="p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ MEMORY MATCH</div>
        <div className="flex gap-1">
          <span className="pill pill-info">moves {moves}</span>
          {done && <span className="pill pill-ok">CLEARED</span>}
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1 mx-auto" style={{ width: 260 }}>
        {cards.map((c, i) => (
          <button
            key={c.id}
            onClick={() => flip(i)}
            className="card-pixel flex items-center justify-center"
            style={{
              padding: 0,
              aspectRatio: "1 / 1",
              cursor: c.matched ? "default" : "pointer",
              background: c.matched ? "var(--success)" : c.revealed ? "var(--accent)" : "var(--surface)",
              borderColor: c.matched ? "var(--success)" : c.revealed ? "var(--accent-shadow)" : "var(--surface-2)",
            }}
          >
            <span className="font-pixel text-2xl" style={{ color: c.matched ? "var(--on-accent)" : c.revealed ? "var(--on-accent)" : "transparent" }}>
              {c.sym}
            </span>
          </button>
        ))}
      </div>
      <div className="flex justify-center">
        <button onClick={reset} className="btn-pixel ghost" style={{ padding: "6px 10px", fontSize: 11 }}><Icons.RotateCcw size={12} /> RESET</button>
      </div>
    </div>
  );
}

// ============ MINESWEEPER ============
const MS_ROWS = 9;
const MS_COLS = 9;
const MS_MINES = 10;

type MsCell = { mine: boolean; revealed: boolean; flagged: boolean; n: number };

function buildMsBoard(): MsCell[][] {
  const b: MsCell[][] = [];
  for (let r = 0; r < MS_ROWS; r++) {
    const row: MsCell[] = [];
    for (let c = 0; c < MS_COLS; c++) row.push({ mine: false, revealed: false, flagged: false, n: 0 });
    b.push(row);
  }
  let placed = 0;
  while (placed < MS_MINES) {
    const r = Math.floor(Math.random() * MS_ROWS);
    const c = Math.floor(Math.random() * MS_COLS);
    if (!b[r][c].mine) {
      b[r][c].mine = true;
      placed += 1;
    }
  }
  for (let r = 0; r < MS_ROWS; r++) {
    for (let c = 0; c < MS_COLS; c++) {
      if (b[r][c].mine) continue;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < MS_ROWS && nc >= 0 && nc < MS_COLS && b[nr][nc].mine) n += 1;
      }
      b[r][c].n = n;
    }
  }
  return b;
}

function floodReveal(b: MsCell[][], r: number, c: number) {
  if (r < 0 || r >= MS_ROWS || c < 0 || c >= MS_COLS) return;
  const cell = b[r][c];
  if (cell.revealed || cell.flagged) return;
  cell.revealed = true;
  if (cell.n === 0 && !cell.mine) {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      floodReveal(b, r + dr, c + dc);
    }
  }
}

const N_COLORS = ["", "#3b82f6", "#16a34a", "#dc2626", "#7c3aed", "#b91c1c", "#0891b2", "#000", "#525252"];

export function MinesweeperGame() {
  const [board, setBoard] = useState<MsCell[][]>(buildMsBoard);
  const [over, setOver] = useState(false);
  const [won, setWon] = useState(false);

  function check(b: MsCell[][]): boolean {
    for (let r = 0; r < MS_ROWS; r++) for (let c = 0; c < MS_COLS; c++) {
      if (!b[r][c].mine && !b[r][c].revealed) return false;
    }
    return true;
  }

  function reveal(r: number, c: number) {
    if (over) return;
    const b = board.map((row) => row.map((cell) => ({ ...cell })));
    if (b[r][c].flagged) return;
    if (b[r][c].mine) {
      // Reveal all mines
      for (const row of b) for (const cell of row) if (cell.mine) cell.revealed = true;
      setBoard(b);
      setOver(true);
      return;
    }
    floodReveal(b, r, c);
    setBoard(b);
    if (check(b)) {
      setWon(true);
      setOver(true);
    }
  }

  function flag(r: number, c: number, e: React.MouseEvent) {
    e.preventDefault();
    if (over) return;
    const b = board.map((row) => row.map((cell) => ({ ...cell })));
    if (b[r][c].revealed) return;
    b[r][c].flagged = !b[r][c].flagged;
    setBoard(b);
  }

  function reset() {
    setBoard(buildMsBoard());
    setOver(false);
    setWon(false);
  }

  const flags = board.flat().filter((c) => c.flagged).length;

  return (
    <div className="p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ MINESWEEPER</div>
        <div className="flex gap-1">
          <span className="pill pill-info">{MS_MINES - flags} mines</span>
          {over && !won && <span className="pill pill-bad">💥 BOOM</span>}
          {won && <span className="pill pill-ok">✓ CLEARED</span>}
        </div>
      </div>
      <div
        className="grid mx-auto select-none"
        style={{
          gridTemplateColumns: `repeat(${MS_COLS}, 1fr)`,
          width: 288,
          aspectRatio: "1 / 1",
          background: "var(--surface-2)",
          border: "2px solid var(--surface-2)",
          gap: 1,
        }}
      >
        {board.flatMap((row, r) =>
          row.map((cell, c) => (
            <button
              key={`${r}-${c}`}
              onClick={() => reveal(r, c)}
              onContextMenu={(e) => flag(r, c, e)}
              style={{
                background: cell.revealed
                  ? cell.mine
                    ? "var(--danger)"
                    : "var(--bg)"
                  : "var(--surface)",
                color: cell.revealed && cell.n > 0 ? N_COLORS[cell.n] : "var(--fg)",
                border: cell.revealed ? "1px inset var(--surface-2)" : "2px outset var(--fg)",
                fontFamily: "monospace",
                fontWeight: 800,
                fontSize: 13,
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
              }}
            >
              {cell.flagged ? "⚑" : cell.revealed ? (cell.mine ? "💣" : cell.n > 0 ? cell.n : "") : ""}
            </button>
          )),
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-[color:var(--muted)]">left-click reveal · right-click flag</span>
        <button onClick={reset} className="btn-pixel ghost" style={{ padding: "4px 10px", fontSize: 10 }}>
          <Icons.RotateCcw size={10} /> NEW GAME
        </button>
      </div>
    </div>
  );
}

// ============ 2048 ============
const G2048_SIZE = 4;
type G2048Board = number[][];

function emptyBoard(): G2048Board {
  return Array.from({ length: G2048_SIZE }, () => new Array(G2048_SIZE).fill(0));
}

function addRandom(b: G2048Board): G2048Board {
  const empties: Array<[number, number]> = [];
  for (let r = 0; r < G2048_SIZE; r++) for (let c = 0; c < G2048_SIZE; c++) if (b[r][c] === 0) empties.push([r, c]);
  if (empties.length === 0) return b;
  const [r, c] = empties[Math.floor(Math.random() * empties.length)];
  b[r][c] = Math.random() < 0.9 ? 2 : 4;
  return b;
}

function slideRow(row: number[]): { row: number[]; gained: number } {
  const filtered = row.filter((v) => v !== 0);
  let gained = 0;
  for (let i = 0; i < filtered.length - 1; i++) {
    if (filtered[i] === filtered[i + 1]) {
      filtered[i] *= 2;
      gained += filtered[i];
      filtered.splice(i + 1, 1);
    }
  }
  while (filtered.length < G2048_SIZE) filtered.push(0);
  return { row: filtered, gained };
}

function move(b: G2048Board, dir: "L" | "R" | "U" | "D"): { board: G2048Board; gained: number; moved: boolean } {
  const before = JSON.stringify(b);
  let gained = 0;
  const next = b.map((row) => [...row]);
  if (dir === "L" || dir === "R") {
    for (let r = 0; r < G2048_SIZE; r++) {
      const row = dir === "R" ? next[r].slice().reverse() : next[r];
      const { row: slid, gained: g } = slideRow(row);
      gained += g;
      next[r] = dir === "R" ? slid.reverse() : slid;
    }
  } else {
    for (let c = 0; c < G2048_SIZE; c++) {
      const col = next.map((row) => row[c]);
      const oriented = dir === "D" ? col.slice().reverse() : col;
      const { row: slid, gained: g } = slideRow(oriented);
      gained += g;
      const final = dir === "D" ? slid.reverse() : slid;
      for (let r = 0; r < G2048_SIZE; r++) next[r][c] = final[r];
    }
  }
  const moved = JSON.stringify(next) !== before;
  return { board: next, gained, moved };
}

const TILE_COLORS: Record<number, { bg: string; fg: string }> = {
  0: { bg: "rgba(238,228,218,0.35)", fg: "transparent" },
  2: { bg: "#eee4da", fg: "#776e65" },
  4: { bg: "#ede0c8", fg: "#776e65" },
  8: { bg: "#f2b179", fg: "#fff" },
  16: { bg: "#f59563", fg: "#fff" },
  32: { bg: "#f67c5f", fg: "#fff" },
  64: { bg: "#f65e3b", fg: "#fff" },
  128: { bg: "#edcf72", fg: "#fff" },
  256: { bg: "#edcc61", fg: "#fff" },
  512: { bg: "#edc850", fg: "#fff" },
  1024: { bg: "#edc53f", fg: "#fff" },
  2048: { bg: "#edc22e", fg: "#fff" },
};

export function Game2048() {
  const [board, setBoard] = useState<G2048Board>(() => addRandom(addRandom(emptyBoard())));
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [over, setOver] = useState(false);

  useEffect(() => {
    try { setBest(Number(localStorage.getItem("delos.2048.best") ?? 0)); } catch {}
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Focus guard — see SnakeGame comment. preventDefault below was eating
      // every w/a/s/d character typed into any input on the page.
      if (isTypingTarget(e.target)) return;
      let dir: "L" | "R" | "U" | "D" | null = null;
      if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") dir = "L";
      else if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") dir = "R";
      else if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") dir = "U";
      else if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") dir = "D";
      if (!dir) return;
      e.preventDefault();
      setBoard((prev) => {
        const { board: next, gained, moved } = move(prev, dir!);
        if (!moved) return prev;
        addRandom(next);
        setScore((s) => {
          const ns = s + gained;
          setBest((b) => {
            const nb = Math.max(b, ns);
            try { localStorage.setItem("delos.2048.best", String(nb)); } catch {}
            return nb;
          });
          return ns;
        });
        // Check game over: if no moves possible
        let canMove = false;
        for (const d of ["L", "R", "U", "D"] as const) {
          if (move(next, d).moved) { canMove = true; break; }
        }
        if (!canMove) setOver(true);
        return next;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function reset() {
    setBoard(addRandom(addRandom(emptyBoard())));
    setScore(0);
    setOver(false);
  }

  return (
    <div className="p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <div className="font-pixel text-sm tracking-wider" style={{ color: "var(--accent)" }}>★ 2048</div>
        <div className="flex gap-1">
          <span className="pill pill-info">{score}</span>
          <span className="pill pill-muted">BEST {best}</span>
        </div>
      </div>
      <div
        className="grid mx-auto"
        style={{
          gridTemplateColumns: `repeat(${G2048_SIZE}, 1fr)`,
          width: 300,
          aspectRatio: "1 / 1",
          background: "#bbada0",
          padding: 6,
          gap: 6,
        }}
      >
        {board.flatMap((row, r) =>
          row.map((v, c) => {
            const t = TILE_COLORS[v] ?? { bg: "#3c3a32", fg: "#fff" };
            return (
              <div
                key={`${r}-${c}`}
                style={{
                  background: t.bg,
                  color: t.fg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "monospace",
                  fontWeight: 800,
                  fontSize: v >= 1000 ? 16 : v >= 100 ? 20 : 24,
                }}
              >
                {v === 0 ? "" : v}
              </div>
            );
          }),
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-[color:var(--muted)]">WASD / arrows · merge to 2048</span>
        {over && <span className="pill pill-bad">GAME OVER</span>}
        <button onClick={reset} className="btn-pixel ghost" style={{ padding: "4px 10px", fontSize: 10 }}>
          <Icons.RotateCcw size={10} /> NEW
        </button>
      </div>
    </div>
  );
}
