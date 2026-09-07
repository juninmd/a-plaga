import { COLS, ROWS, canStep, cellCol, cellRow, isWalkable, worldX, worldZ } from "../shared/map.js";
import type { Vec3 } from "../shared/protocol.js";

// ===== A* no grid do mapa (8 vizinhos, sem cortar cantos) =====

const MAX_EXPANSIONS = 1500;

interface Node {
  c: number;
  r: number;
  g: number;
  f: number;
  parent: Node | null;
}

function key(c: number, r: number): number {
  return r * COLS + c;
}

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Caminho em coordenadas de mundo (centros de célula), do ponto `from` até `to`. Vazio se não há rota. */
export function findPath(from: Vec3, to: Vec3): Vec3[] {
  const sc = cellCol(from.x), sr = cellRow(from.z);
  const gc = cellCol(to.x), gr = cellRow(to.z);
  if (!isWalkable(gc, gr)) return [];
  if (sc === gc && sr === gr) return [{ x: to.x, y: 0, z: to.z }];

  const h = (c: number, r: number) => {
    const dx = Math.abs(c - gc), dy = Math.abs(r - gr);
    return Math.max(dx, dy) + 0.41 * Math.min(dx, dy);
  };
  const open: Node[] = [{ c: sc, r: sr, g: 0, f: h(sc, sr), parent: null }];
  const best = new Map<number, number>([[key(sc, sr), 0]]);
  const closed = new Set<number>();
  let expansions = 0;

  while (open.length && expansions < MAX_EXPANSIONS) {
    // Extrai o menor f (lista pequena — O(n) é suficiente para um grid 36x40)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.c, cur.r);
    if (closed.has(ck)) continue;
    closed.add(ck);
    expansions++;
    if (cur.c === gc && cur.r === gr) return rebuild(cur, to);
    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc, nr = cur.r + dr;
      if (!canStep(cur.c, cur.r, nc, nr)) continue;
      // Diagonal só se os dois ortogonais estão livres (sem raspar quina)
      if (dc !== 0 && dr !== 0 && (!canStep(cur.c, cur.r, cur.c + dc, cur.r) || !canStep(cur.c, cur.r, cur.c, cur.r + dr))) continue;
      const g = cur.g + (dc !== 0 && dr !== 0 ? 1.41 : 1);
      const nk = key(nc, nr);
      if (closed.has(nk)) continue;
      const prev = best.get(nk);
      if (prev != null && prev <= g) continue;
      best.set(nk, g);
      open.push({ c: nc, r: nr, g, f: g + h(nc, nr), parent: cur });
    }
  }
  return [];
}

function rebuild(n: Node, to: Vec3): Vec3[] {
  const out: Vec3[] = [];
  let cur: Node | null = n;
  while (cur) {
    out.push({ x: worldX(cur.c), y: 0, z: worldZ(cur.r) });
    cur = cur.parent;
  }
  out.reverse();
  out.shift(); // célula atual não é destino
  out.push({ x: to.x, y: 0, z: to.z });
  return out;
}

/** Célula do ponto (útil para cache: recalcula só quando o alvo muda de célula). */
export function cellKey(p: Vec3): string {
  return `${cellCol(p.x)},${cellRow(p.z)}`;
}

export function isNavWalkableAt(p: Vec3): boolean {
  return isWalkable(cellCol(p.x), cellRow(p.z));
}

export const NAV_DIMS = { cols: COLS, rows: ROWS };
