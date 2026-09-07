import type { Vec3 } from "./protocol.js";
import { BALANCE } from "./balance.js";

export type BoxKind = "wall" | "crate" | "low" | "arch" | "roof" | "barrel" | "pillar" | "platform" | "step";

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

// ===== "de_plague2" — layout inspirado no de_dust2, compacto, adaptado para Zombie Plague =====
// Norte = linha 0. Humanos (CT) nascem ao norte, zumbis (T) ao sul.
//   '#' parede 8m       'C' caixote 3m       'x' caixote baixo 1.5m (dá pra subir)
//   'A' arco/porta (passa por baixo)          'T' túnel coberto (teto a 3.5m)
//   'B' barril (sólido)  'P' pilar             'w' saco de areia 1m (pula por cima)
//   'R' plataforma 2m (anda em cima)          '^' 'v' '<' '>' escada subindo na direção da seta
export const CELL = 4;
export const GRID: readonly string[] = [
  "##########################", // 0
  "#RR....##........##..C.RR#", // 1  B site (plataforma) | CT spawn | A site (plataforma)
  "#RR.x..AA........AA...>RR#", // 2  B doors | rampa A | escada p/ plataforma A
  "#^.....##...x....##....B.#", // 3  escada p/ plataforma B
  "#..C...##........##.x....#", // 4
  "#......##........##......#", // 5
  "###AA######....#####...###", // 6  B->túneis | mid doors | A->long
  "#TTTT######....####......#", // 7  túneis cobertos | mid | long
  "#TTTT######....####..x...#", // 8
  "#TTTT######..............#", // 9  short: mid <-> long
  "#TTTT######R.......w.....#", // 10 plataforma do mid | saco de areia no long
  "#TTTT######^...####......#", // 11 escada p/ plataforma do mid
  "#..x.######....#####.AA###", // 12 long doors
  "#.........A....####......#", // 13 túneis <-> mid
  "#.........A....####......#", // 14
  "#....######....####.....R#", // 15 plataforma do long
  "#.C..######.x..####..C..R#", // 16
  "#....######....####.....^#", // 17 escada p/ plataforma do long
  "#....######....####......#", // 18
  "#....######....####......#", // 19
  "#....#######AA#######...##", // 20 saídas para o T spawn
  "#........................#", // 21 T spawn
  "#..x...C.....RR.....x....#", // 22 plataforma do T spawn
  "#......C.....RR<...####..#", // 23 escada p/ plataforma
  "#.B......x.........####.B#", // 24
  "#...........C............#", // 25
  "#.....x............x.....#", // 26
  "##########################", // 27
];

export const COLS = GRID[0].length;
export const ROWS = GRID.length;

const WALL_H = 8;
const CRATE_H = 3;
const LOW_H = 1.5;
const SANDBAG_H = 1.0;
const ARCH_Y = 3.2; // altura livre debaixo de um arco
const TUNNEL_Y = 3.5;
export const PLATFORM_H = 2;
const STEPS = 4; // degraus por célula de escada (rise 0.5 m, run 1 m)
/** Altura máxima que um jogador sobe andando (degraus, meio-fio). */
export const STEP_HEIGHT = 0.55;

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

const STAIR_DIR: Record<string, [number, number]> = { "^": [0, -1], v: [0, 1], "<": [-1, 0], ">": [1, 0] };

export type CellType = "blocked" | "floor" | "platform" | "stair";

export function cellType(c: number, r: number): CellType {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return "blocked";
  const ch = GRID[r][c];
  if (ch === "." || ch === "A" || ch === "T") return "floor";
  if (ch === "R") return "platform";
  if (ch in STAIR_DIR) return "stair";
  return "blocked";
}

/** Célula atravessável a pé (bots usam para A*). Caixotes contam como bloqueio. */
export function isWalkable(c: number, r: number): boolean {
  return cellType(c, r) !== "blocked";
}

/**
 * Dá para andar da célula a para a vizinha b? Chão não sobe direto numa plataforma (2 m):
 * só pela escada, e a escada só desemboca na plataforma na direção da seta.
 */
export function canStep(c0: number, r0: number, c1: number, r1: number): boolean {
  const a = cellType(c0, r0);
  const b = cellType(c1, r1);
  if (a === "blocked" || b === "blocked") return false;
  const dc = c1 - c0;
  const dr = r1 - r0;
  if (a === "stair" || b === "stair") {
    if (dc !== 0 && dr !== 0) return false; // sem diagonal em escada
    const stairFirst = a === "stair";
    const sc = stairFirst ? c0 : c1;
    const sr = stairFirst ? r0 : r1;
    const dirC = stairFirst ? dc : -dc;
    const dirR = stairFirst ? dr : -dr;
    const other = stairFirst ? b : a;
    const up = STAIR_DIR[GRID[sr][sc]];
    const towardsTop = up[0] === dirC && up[1] === dirR;
    if (other === "platform") return towardsTop;
    if (other === "floor") return !towardsTop;
    return true; // escada com escada
  }
  if ((a === "floor") !== (b === "floor")) return false; // chão x plataforma
  return true;
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
      if (ch === "#" || ch === "A" || ch === "T" || ch === "R") {
        let c1 = c;
        while (c1 + 1 < COLS && GRID[r][c1 + 1] === ch) c1++;
        if (ch === "#") b.push(box(cx0(c), 0, rz0(r), cx0(c1 + 1), WALL_H, rz0(r + 1), "wall"));
        else if (ch === "A") b.push(box(cx0(c), ARCH_Y, rz0(r), cx0(c1 + 1), WALL_H, rz0(r + 1), "arch"));
        else if (ch === "R") b.push(box(cx0(c), 0, rz0(r), cx0(c1 + 1), PLATFORM_H, rz0(r + 1), "platform"));
        else b.push(box(cx0(c), TUNNEL_Y, rz0(r), cx0(c1 + 1), TUNNEL_Y + 0.6, rz0(r + 1), "roof"));
        c = c1 + 1;
        continue;
      }
      if (ch in STAIR_DIR) {
        // Degraus do lado baixo (oposto à seta) até a borda alta, no nível da plataforma
        const [dx, dz] = STAIR_DIR[ch];
        const run = CELL / STEPS;
        for (let k = 0; k < STEPS; k++) {
          const h = (PLATFORM_H / STEPS) * (k + 1);
          const lo = k * run;
          const hi = (k + 1) * run;
          if (dx !== 0) {
            const x0 = dx > 0 ? cx0(c) + lo : cx0(c + 1) - lo;
            const x1 = dx > 0 ? cx0(c) + hi : cx0(c + 1) - hi;
            b.push(box(x0, 0, rz0(r), x1, h, rz0(r + 1), "step"));
          } else {
            const z0 = dz > 0 ? rz0(r) + lo : rz0(r + 1) - lo;
            const z1 = dz > 0 ? rz0(r) + hi : rz0(r + 1) - hi;
            b.push(box(cx0(c), 0, z0, cx0(c + 1), h, z1, "step"));
          }
        }
      } else if (ch === "C" || ch === "x") {
        const h = ch === "C" ? CRATE_H : LOW_H;
        const pad = 0.4; // caixote menor que a célula — dá pra contornar
        b.push(box(cx0(c) + pad, 0, rz0(r) + pad, cx0(c + 1) - pad, h, rz0(r + 1) - pad, ch === "C" ? "crate" : "low"));
        props.push({ kind: ch === "C" ? "crate" : "lowcrate", pos: { x: worldX(c), y: 0, z: worldZ(r) } });
      } else if (ch === "w") {
        b.push(box(cx0(c), 0, rz0(r) + 1.2, cx0(c + 1), SANDBAG_H, rz0(r + 1) - 1.2, "low"));
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
    spawn(9, 1, Math.PI), spawn(11, 1, Math.PI), spawn(13, 1, Math.PI), spawn(15, 1, Math.PI),
    spawn(10, 3, Math.PI), spawn(14, 3, Math.PI), spawn(16, 3, Math.PI), spawn(9, 4, Math.PI),
    spawn(11, 4, Math.PI), spawn(13, 4, Math.PI), spawn(15, 4, Math.PI), spawn(12, 5, Math.PI),
  ],
  // Zumbis: T spawn (sul), olhando para o norte
  zombieSpawns: [
    spawn(3, 26, 0), spawn(8, 26, 0), spawn(12, 26, 0), spawn(16, 26, 0),
    spawn(22, 26, 0), spawn(24, 25, 0), spawn(4, 24, 0), spawn(11, 25, 0),
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
export interface CollisionOut {
  /** true quando o corpo ficou apoiado no topo de um box neste passo */
  ground: boolean;
}

export function resolveCollision(pos: Vec3, vel: Vec3, radius: number, boxes: Aabb[], height: number = BALANCE.playerHeight, out?: CollisionOut): boolean {
  if (out) out.ground = false;
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
      // Topo ao alcance de um passo (degrau, caixote baixo ao cair): sobe e fica apoiado.
      // Tocar a lateral de uma parede alta NÃO conta como chão — era isso que deixava escalar feito aranha.
      if (vel.y <= 0.01 && b.max.y - pos.y <= STEP_HEIGHT) {
        pos.y = b.max.y;
        vel.y = 0;
        if (out) out.ground = true;
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
