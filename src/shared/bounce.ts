import type { Aabb } from "./map.js";
import { MAP_SIZE } from "./map.js";
import type { Vec3 } from "./protocol.js";

// ===== Corpo rígido esférico: granadas e cuspe quicam em paredes, caixas e chão =====

export interface BounceBody {
  pos: Vec3;
  vel: Vec3;
  radius: number;
  /** Fração da velocidade normal devolvida no impacto (0 = massa, 1 = borracha). */
  restitution: number;
  /** Fração da velocidade tangencial perdida por impacto. */
  friction: number;
  /** Decaimento por segundo enquanto rola no chão. */
  rolling: number;
}

export interface BounceHit {
  /** Velocidade normal no impacto mais forte do passo (m/s). 0 = sem impacto. */
  impact: number;
  normal: Vec3 | null;
  grounded: boolean;
}

const SUBSTEPS = 6;
const REST_SPEED = 1.2;

export function makeBody(pos: Vec3, vel: Vec3, over: Partial<BounceBody> = {}): BounceBody {
  return { pos: { ...pos }, vel: { ...vel }, radius: 0.12, restitution: 0.45, friction: 0.18, rolling: 2.6, ...over };
}

function reflect(b: BounceBody, nx: number, ny: number, nz: number, hit: BounceHit) {
  const vn = b.vel.x * nx + b.vel.y * ny + b.vel.z * nz;
  if (vn >= 0) return;
  // Velocidade normal -> restitui (com amortecimento); tangencial -> perde atrito
  const tx = b.vel.x - vn * nx;
  const ty = b.vel.y - vn * ny;
  const tz = b.vel.z - vn * nz;
  const keep = 1 - b.friction;
  const rest = -vn < REST_SPEED ? 0 : b.restitution;
  b.vel.x = tx * keep - vn * rest * nx;
  b.vel.y = ty * keep - vn * rest * ny;
  b.vel.z = tz * keep - vn * rest * nz;
  if (-vn > hit.impact) {
    hit.impact = -vn;
    hit.normal = { x: nx, y: ny, z: nz };
  }
}

/** Integra um passo (com sub-passos para não atravessar paredes finas). */
export function stepBody(b: BounceBody, dt: number, boxes: readonly Aabb[], gravity: number): BounceHit {
  const hit: BounceHit = { impact: 0, normal: null, grounded: false };
  const h = dt / SUBSTEPS;
  const r = b.radius;
  for (let s = 0; s < SUBSTEPS; s++) {
    b.vel.y -= gravity * h;
    b.pos.x += b.vel.x * h;
    b.pos.y += b.vel.y * h;
    b.pos.z += b.vel.z * h;

    for (const bx of boxes) {
      const cx = Math.max(bx.min.x, Math.min(b.pos.x, bx.max.x));
      const cy = Math.max(bx.min.y, Math.min(b.pos.y, bx.max.y));
      const cz = Math.max(bx.min.z, Math.min(b.pos.z, bx.max.z));
      let dx = b.pos.x - cx;
      let dy = b.pos.y - cy;
      let dz = b.pos.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      let nx: number, ny: number, nz: number;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        nx = dx / d; ny = dy / d; nz = dz / d;
        b.pos.x = cx + nx * r;
        b.pos.y = cy + ny * r;
        b.pos.z = cz + nz * r;
      } else {
        // Centro dentro do box: sai pela face mais próxima
        dx = Math.min(b.pos.x - bx.min.x, bx.max.x - b.pos.x);
        dy = Math.min(b.pos.y - bx.min.y, bx.max.y - b.pos.y);
        dz = Math.min(b.pos.z - bx.min.z, bx.max.z - b.pos.z);
        if (dy <= dx && dy <= dz) {
          const up = bx.max.y - b.pos.y < b.pos.y - bx.min.y;
          ny = up ? 1 : -1; nx = nz = 0;
          b.pos.y = up ? bx.max.y + r : bx.min.y - r;
        } else if (dx <= dz) {
          const pos = bx.max.x - b.pos.x < b.pos.x - bx.min.x;
          nx = pos ? 1 : -1; ny = nz = 0;
          b.pos.x = pos ? bx.max.x + r : bx.min.x - r;
        } else {
          const pos = bx.max.z - b.pos.z < b.pos.z - bx.min.z;
          nz = pos ? 1 : -1; nx = ny = 0;
          b.pos.z = pos ? bx.max.z + r : bx.min.z - r;
        }
      }
      reflect(b, nx, ny, nz, hit);
      if (ny > 0.7) hit.grounded = true;
    }

    // Chão
    if (b.pos.y < r) {
      b.pos.y = r;
      reflect(b, 0, 1, 0, hit);
      hit.grounded = true;
    }
    // Limites do mapa
    const lx = MAP_SIZE.x - r;
    const lz = MAP_SIZE.z - r;
    if (b.pos.x < -lx) { b.pos.x = -lx; reflect(b, 1, 0, 0, hit); }
    if (b.pos.x > lx) { b.pos.x = lx; reflect(b, -1, 0, 0, hit); }
    if (b.pos.z < -lz) { b.pos.z = -lz; reflect(b, 0, 0, 1, hit); }
    if (b.pos.z > lz) { b.pos.z = lz; reflect(b, 0, 0, -1, hit); }

    if (hit.grounded && Math.abs(b.vel.y) < 0.01) {
      const k = Math.max(0, 1 - b.rolling * h);
      b.vel.x *= k;
      b.vel.z *= k;
    }
  }
  return hit;
}
