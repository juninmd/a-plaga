import type { Vec3 } from "./protocol.js";
import { BALANCE } from "./balance.js";

export type BoxKind = "wall" | "crate" | "low" | "arch" | "roof" | "barrel" | "pillar";

export interface Aabb {
  min: Vec3;
  max: Vec3;
  kind?: BoxKind;
}

export interface Prop {
  kind: "barrel" | "crate" | "lowcrate" | "pillar";
  pos: Vec3;
}

export interface MapDef {
  name: string;
  size: Vec3; // bounds of playable area
  boxes: Aabb[]; // solid obstacles (walls, crates, containers)
  props: Prop[]; // objetos decorativos (posição central no chão)
  spawns: { pos: Vec3; yaw: number }[]; // human spawns
  zombieSpawns: { pos: Vec3; yaw: number }[];
  floor: { color: number };
}

// ===== "de_plague2" — layout inspirado no de_dust2, adaptado para Zombie Plague =====
// Norte = linha 0. Humanos (CT) nascem ao norte, zumbis (T) ao sul.
//   '#' parede 8m       'C' caixote 3m       'x' caixote baixo 1.5m (dá pra subir)
//   'A' arco/porta (passa por baixo)          'T' túnel coberto (teto a 3.5m)
//   'B' barril (sólido)  'P' pilar             '.' chão
export const CELL = 4;
export const GRID: readonly string[] = [
  "####################################", // 0
  "#.......##..........##.............#", // 1  B site | CT spawn | A site
  "#..CC...##..........##.....CC..B...#", // 2
  "#..C....AA..........AA....xCC......#", // 3  B doors | rampa A
  "#.......AA..........AA.............#", // 4
  "#.x.....##..........##...x.....B...#", // 5
  "#.......##..........##.....P.......#", // 6
  "#...x...######....####.............#", // 7  mid doors
  "###AA#########....####.............#", // 8  B -> túneis
  "#TTTTT########....####AA###........#", // 9  short/catwalk -> A | long A
  "#TTTTT########..........###........#", // 10
  "#TTTTT########.....x....###...B....#", // 11
  "#TTTTT########....#########........#", // 12
  "#TTTTT########....#########...x....#", // 13
  "#TTTTT########.C..#########........#", // 14
  "#TTTTT########....#########........#", // 15
  "###TT#########....###########AA#####", // 16 pinch túneis | long doors
  "#.....########....#########........#", // 17
  "#..x..########....#########.....x..#", // 18
  "#.....########....#########........#", // 19
  "#.....########....#########.B......#", // 20
  "#.....#......A....#########........#", // 21 túneis <-> mid
  "#.....#......A....#########........#", // 22
  "#.....########..x.#########........#", // 23
  "#..C..########....#########.....B..#", // 24
  "#.....########....#########........#", // 25
  "#.....########....#########........#", // 26
  "#.....#########AAA###########...####", // 27 saídas para o T spawn
  "#..................................#", // 28 T spawn
  "#...x......C.C........B............#", // 29
  "#.........####.........#####.......#", // 30
  "#.........####..x......#####...C...#", // 31
  "#.........####.........#####.......#", // 32
  "#.....C............................#", // 33
  "#.......x............x.............#", // 34
  "#..........CC.........BB...........#", // 35
  "#..................................#", // 36
  "#....x.....................x.......#", // 37
  "#..................................#", // 38
  "####################################", // 39
];

export const COLS = GRID[0].length;
export const ROWS = GRID.length;

const WALL_H = 8;
const CRATE_H = 3;
const LOW_H = 1.5;
const ARCH_Y = 3.2; // altura livre debaixo de um arco
const TUNNEL_Y = 3.5;

export const MAP_SIZE: Vec3 = { x: (COLS * CELL) / 2, y: 40, z: (ROWS * CELL) / 2 };

export function worldX(c: number): number {
  return (c + 0.5) * CELL - MAP_SIZE.x;
}
export function worldZ(r: number): number {
  return (r + 0.5) * CELL - MAP_SIZE.z;
}
export function cellCol(x: number): number {
  return Math.max(0, Math.min(COLS - 1, Math.floor((x + MAP_SIZE.x) / CELL)));
}
export function cellRow(z: number): number {
  return Math.max(0, Math.min(ROWS - 1, Math.floor((z + MAP_SIZE.z) / CELL)));
}

/** Célula atravessável a pé (bots usam para A*). Caixotes baixos contam como bloqueio. */
export function isWalkable(c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  const ch = GRID[r][c];
  return ch === "." || ch === "A" || ch === "T";
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, kind: BoxKind): Aabb {
  return {
    min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
    kind,
  };
}

function buildBoxes(): { boxes: Aabb[]; props: Prop[] } {
  const b: Aabb[] = [];
  const props: Prop[] = [];
  const cx0 = (c: number) => c * CELL - MAP_SIZE.x;
  const rz0 = (r: number) => r * CELL - MAP_SIZE.z;
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const ch = GRID[r][c];
      // Mescla runs horizontais do mesmo tipo (menos AABBs, menos draw calls)
      if (ch === "#" || ch === "A" || ch === "T") {
        let c1 = c;
        while (c1 + 1 < COLS && GRID[r][c1 + 1] === ch) c1++;
        if (ch === "#") b.push(box(cx0(c), 0, rz0(r), cx0(c1 + 1), WALL_H, rz0(r + 1), "wall"));
        else if (ch === "A") b.push(box(cx0(c), ARCH_Y, rz0(r), cx0(c1 + 1), WALL_H, rz0(r + 1), "arch"));
        else b.push(box(cx0(c), TUNNEL_Y, rz0(r), cx0(c1 + 1), TUNNEL_Y + 0.6, rz0(r + 1), "roof"));
        c = c1 + 1;
        continue;
      }
      if (ch === "C" || ch === "x") {
        const h = ch === "C" ? CRATE_H : LOW_H;
        const pad = 0.4; // caixote menor que a célula — dá pra contornar
        b.push(box(cx0(c) + pad, 0, rz0(r) + pad, cx0(c + 1) - pad, h, rz0(r + 1) - pad, ch === "C" ? "crate" : "low"));
        props.push({ kind: ch === "C" ? "crate" : "lowcrate", pos: { x: worldX(c), y: 0, z: worldZ(r) } });
      } else if (ch === "B") {
        const r0 = 0.55;
        b.push(box(worldX(c) - r0, 0, worldZ(r) - r0, worldX(c) + r0, 1.2, worldZ(r) + r0, "barrel"));
        props.push({ kind: "barrel", pos: { x: worldX(c), y: 0, z: worldZ(r) } });
      } else if (ch === "P") {
        const r0 = 0.6;
        b.push(box(worldX(c) - r0, 0, worldZ(r) - r0, worldX(c) + r0, WALL_H, worldZ(r) + r0, "pillar"));
        props.push({ kind: "pillar", pos: { x: worldX(c), y: 0, z: worldZ(r) } });
      }
      c++;
    }
  }
  return { boxes: b, props };
}

function spawn(c: number, r: number, yaw: number): { pos: Vec3; yaw: number } {
  return { pos: { x: worldX(c), y: 0, z: worldZ(r) }, yaw };
}

const built = buildBoxes();

export const MAP: MapDef = {
  name: "de_plague2",
  size: MAP_SIZE,
  boxes: built.boxes,
  props: built.props,
  // Humanos: CT spawn (norte), olhando para o sul (meio/T)
  spawns: [
    spawn(11, 2, Math.PI), spawn(13, 2, Math.PI), spawn(15, 2, Math.PI), spawn(17, 2, Math.PI),
    spawn(12, 4, Math.PI), spawn(14, 4, Math.PI), spawn(16, 4, Math.PI), spawn(18, 4, Math.PI),
    spawn(11, 5, Math.PI), spawn(15, 5, Math.PI), spawn(13, 3, Math.PI), spawn(17, 3, Math.PI),
  ],
  // Zumbis: T spawn (sul), olhando para o norte
  zombieSpawns: [
    spawn(3, 36, 0), spawn(8, 37, 0), spawn(15, 37, 0), spawn(19, 36, 0),
    spawn(25, 37, 0), spawn(31, 36, 0), spawn(9, 33, 0), spawn(30, 33, 0),
  ],
  floor: { color: 0xc9a06a },
};

// ===== Física compartilhada (AABB) =====

export function boxIntersectsSphere(b: Aabb, cx: number, cy: number, cz: number, r: number): boolean {
  const nx = Math.max(b.min.x, Math.min(cx, b.max.x));
  const ny = Math.max(b.min.y, Math.min(cy, b.max.y));
  const nz = Math.max(b.min.z, Math.min(cz, b.max.z));
  const dx = cx - nx;
  const dy = cy - ny;
  const dz = cz - nz;
  return dx * dx + dy * dy + dz * dz < r * r;
}

export function pointInsideBox(b: Aabb, x: number, y: number, z: number): boolean {
  return x >= b.min.x && x <= b.max.x && y >= b.min.y && y <= b.max.y && z >= b.min.z && z <= b.max.z;
}

// Ray-AABB (slab method) — retorna distância do hit ou Infinity.
export function rayAabb(orig: Vec3, dir: Vec3, b: Aabb): number {
  let tmin = 0;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const o = i === 0 ? orig.x : i === 1 ? orig.y : orig.z;
    const d = i === 0 ? dir.x : i === 1 ? dir.y : dir.z;
    const mn = i === 0 ? b.min.x : i === 1 ? b.min.y : b.min.z;
    const mx = i === 0 ? b.max.x : i === 1 ? b.max.y : b.max.z;
    if (Math.abs(d) < 1e-9) {
      if (o < mn || o > mx) return Infinity;
    } else {
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

/**
 * Colisão por eixo com correção de penetração. `height` é a altura do corpo (agachado é menor),
 * usada para passar por baixo de arcos/túneis e bater a cabeça neles. Retorna true se encostou.
 */
export function resolveCollision(pos: Vec3, vel: Vec3, radius: number, boxes: Aabb[], height: number = BALANCE.playerHeight): boolean {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      // Pés acima do topo do box: dá pra pular caixotes baixos
      if (pos.y >= b.max.y) continue;
      // Cabeça abaixo da base do box: passa por baixo (arcos, teto de túnel)
      if (pos.y + height <= b.min.y) continue;
      const ex = { min: { ...b.min }, max: { ...b.max } };
      ex.min.x -= radius; ex.max.x += radius;
      ex.min.z -= radius; ex.max.z += radius;
      if (!(pos.x > ex.min.x && pos.x < ex.max.x && pos.z > ex.min.z && pos.z < ex.max.z)) continue;
      hit = true;
      // Box acima da cabeça: bate e cai
      if (b.min.y > pos.y + 0.3) {
        pos.y = b.min.y - height;
        if (vel.y > 0) vel.y = 0;
        continue;
      }
      // Caindo perto do topo → aterrissa em cima (dá pra subir em caixotes)
      if (vel.y <= 0 && pos.y >= b.max.y - 0.5) {
        pos.y = b.max.y;
        vel.y = 0;
        continue;
      }
      // Empurra para fora na menor penetração (x ou z)
      const dx1 = pos.x - ex.min.x;
      const dx2 = ex.max.x - pos.x;
      const dz1 = pos.z - ex.min.z;
      const dz2 = ex.max.z - pos.z;
      const m = Math.min(dx1, dx2, dz1, dz2);
      if (m === dx1) { pos.x = ex.min.x; if (vel.x < 0) vel.x = 0; }
      else if (m === dx2) { pos.x = ex.max.x; if (vel.x > 0) vel.x = 0; }
      else if (m === dz1) { pos.z = ex.min.z; if (vel.z < 0) vel.z = 0; }
      else { pos.z = ex.max.z; if (vel.z > 0) vel.z = 0; }
    }
    // Limites do mapa
    const H = MAP_SIZE.x - radius;
    const D = MAP_SIZE.z - radius;
    if (pos.x < -H) { pos.x = -H; vel.x = 0; }
    if (pos.x > H) { pos.x = H; vel.x = 0; }
    if (pos.z < -D) { pos.z = -D; vel.z = 0; }
    if (pos.z > D) { pos.z = D; vel.z = 0; }
    if (pos.y < 0) { pos.y = 0; }
  }
  return hit;
}

// Raycast contra todos os boxes — retorna hit mais próximo.
export function raycastMap(orig: Vec3, dir: Vec3, boxes: Aabb[]): { t: number; normal: Vec3 } | null {
  let best = Infinity;
  let hitBox: Aabb | null = null;
  for (const b of boxes) {
    const t = rayAabb(orig, dir, b);
    if (t < best) {
      best = t;
      hitBox = b;
    }
  }
  if (!hitBox || !isFinite(best)) return null;
  const p = { x: orig.x + dir.x * best, y: orig.y + dir.y * best, z: orig.z + dir.z * best };
  // Normal pela face mais próxima do ponto de impacto
  const eps = 0.02;
  let normal: Vec3;
  if (Math.abs(p.x - hitBox.min.x) < eps) normal = { x: -1, y: 0, z: 0 };
  else if (Math.abs(p.x - hitBox.max.x) < eps) normal = { x: 1, y: 0, z: 0 };
  else if (Math.abs(p.z - hitBox.min.z) < eps) normal = { x: 0, y: 0, z: -1 };
  else if (Math.abs(p.z - hitBox.max.z) < eps) normal = { x: 0, y: 0, z: 1 };
  else if (Math.abs(p.y - hitBox.max.y) < eps) normal = { x: 0, y: 1, z: 0 };
  else normal = { x: 0, y: -1, z: 0 };
  return { t: best, normal };
}
