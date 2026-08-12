import type { Vec3 } from "./protocol.js";

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface MapDef {
  size: Vec3; // bounds of playable area
  boxes: Aabb[]; // solid obstacles (walls, crates, containers)
  spawns: { pos: Vec3; yaw: number }[]; // human spawns
  zombieSpawns: { pos: Vec3; yaw: number }[];
  floor: { color: number; name: string };
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Aabb {
  return {
    min: { x: Math.min(x0, x1), y: Math.min(y0, y1), z: Math.min(z0, z1) },
    max: { x: Math.max(x0, x1), y: Math.max(y0, y1), z: Math.max(z0, z1) },
  };
}

// ===== "de_plague" — arena inspirada em mapa de CS 1.6 =====
// Coordenadas: x lateral (-H..H), y altura, z profundidade. Y = 0 é o chão.

export const MAP_SIZE: Vec3 = { x: 48, y: 40, z: 48 };

function buildBoxes(): Aabb[] {
  const b: Aabb[] = [];
  const H = MAP_SIZE.x;
  const D = MAP_SIZE.z;
  // Perímetro (4 paredes)
  b.push(box(-H, 0, -D, -H + 1, 8, D));
  b.push(box(H - 1, 0, -D, H, 8, D));
  b.push(box(-H, 0, -D, H, 8, -D + 1));
  b.push(box(-H, 0, D - 1, H, 8, D));
  // Containers centrais (cruz)
  b.push(box(-10, 0, -3, -4, 3.2, 3));
  b.push(box(4, 0, -3, 10, 3.2, 3));
  b.push(box(-3, 0, -10, 3, 3.2, -4));
  b.push(box(-3, 0, 4, 3, 3.2, 10));
  // Pilares de concreto
  b.push(box(-20, 0, -20, -17, 5, -17));
  b.push(box(17, 0, -20, 20, 5, -17));
  b.push(box(-20, 0, 17, -17, 5, 20));
  b.push(box(17, 0, 17, 20, 5, 20));
  // Caixas de madeira espalhadas
  b.push(box(-30, 0, 10, -26, 1.6, 14));
  b.push(box(26, 0, -14, 30, 1.6, -10));
  b.push(box(-12, 0, 20, -8, 1.6, 24));
  b.push(box(8, 0, -24, 12, 1.6, -20));
  b.push(box(14, 0, 14, 18, 1.6, 18));
  b.push(box(-18, 0, -14, -14, 1.6, -10));
  b.push(box(24, 0, 22, 27, 1.6, 25));
  b.push(box(-27, 0, -25, -24, 1.6, -22));
  // Rampa central (degraus simulados por caixas baixas)
  b.push(box(-2.5, 0, -2.5, 2.5, 0.8, 2.5));
  return b;
}

export const MAP: MapDef = {
  size: MAP_SIZE,
  boxes: buildBoxes(),
  spawns: [
    { pos: { x: -30, y: 0, z: -30 }, yaw: Math.PI / 4 },
    { pos: { x: 30, y: 0, z: -30 }, yaw: -Math.PI / 4 },
    { pos: { x: -30, y: 0, z: 30 }, yaw: Math.PI / 4 * 3 },
    { pos: { x: 30, y: 0, z: 30 }, yaw: -Math.PI / 4 * 3 },
    { pos: { x: 0, y: 0, z: -30 }, yaw: 0 },
    { pos: { x: 0, y: 0, z: 30 }, yaw: Math.PI },
    { pos: { x: -30, y: 0, z: 0 }, yaw: Math.PI / 2 },
    { pos: { x: 30, y: 0, z: 0 }, yaw: -Math.PI / 2 },
    { pos: { x: -30, y: 0, z: -30 }, yaw: Math.PI / 4 },
    { pos: { x: 30, y: 0, z: 30 }, yaw: -Math.PI / 4 * 3 },
  ],
  zombieSpawns: [
    { pos: { x: -38, y: 0, z: -38 }, yaw: 0 },
    { pos: { x: 38, y: 0, z: 38 }, yaw: Math.PI },
    { pos: { x: -38, y: 0, z: 38 }, yaw: -Math.PI / 2 },
    { pos: { x: 38, y: 0, z: -38 }, yaw: Math.PI / 2 },
  ],
  floor: { color: 0x8d8d7a, name: "de_plague" },
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

export function resolveCollision(pos: Vec3, vel: Vec3, radius: number, boxes: Aabb[]): boolean {
  // Colisão por eixo, com penetração corrigida. Retorna true se encostou.
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const b of boxes) {
      // Expande o box pelo raio do jogador (colisão de círculo)
      const ex = { min: { ...b.min }, max: { ...b.max } };
      ex.min.x -= radius; ex.max.x += radius;
      ex.min.z -= radius; ex.max.z += radius;
      if (pointInsideBox(ex, pos.x, pos.y, pos.z)) {
        hit = true;
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
  const p = {
    x: orig.x + dir.x * best,
    y: orig.y + dir.y * best,
    z: orig.z + dir.z * best,
  };
  // Normal aproximada pela face mais próxima
  const cx = (hitBox.min.x + hitBox.max.x) / 2;
  const cy = (hitBox.min.y + hitBox.max.y) / 2;
  const cz = (hitBox.min.z + hitBox.max.z) / 2;
  const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  let normal: Vec3;
  if (ax >= ay && ax >= az) normal = { x: Math.sign(dx), y: 0, z: 0 };
  else if (ay >= az) normal = { x: 0, y: Math.sign(dy), z: 0 };
  else normal = { x: 0, y: 0, z: Math.sign(dz) };
  return { t: best, normal };
}
