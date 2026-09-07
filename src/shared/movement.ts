import { BALANCE } from "./balance.js";
import { MAP, resolveCollision } from "./map.js";
import type { Vec3 } from "./protocol.js";

// ===== Modelo de movimento compartilhado: o servidor simula e o cliente prediz com o MESMO código =====

export interface MoverState {
  pos: Vec3;
  vel: Vec3;
  onGround: boolean;
  crouching: boolean;
  yaw: number;
  speedMult: number;
  /** Multiplicador de buff (adrenalina, fúria...). 1 quando não há buff. */
  buffSpeed: number;
  gravityMult: number;
  scale: number;
}

export interface MoveInput {
  moveX: number;
  moveY: number;
  jump: boolean;
  crouch: boolean;
}

export const GROUND_ACCEL = 60;
export const AIR_ACCEL = 8;

export function moverHeight(m: Pick<MoverState, "crouching" | "scale">): number {
  return (m.crouching ? BALANCE.crouchHeight : BALANCE.playerHeight) * m.scale;
}

/** Só levanta se a cabeça couber (arcos e túneis). */
function updateCrouch(m: MoverState, wantCrouch: boolean) {
  if (wantCrouch) {
    m.crouching = true;
    return;
  }
  if (!m.crouching) return;
  const probe = { x: m.pos.x, y: m.pos.y, z: m.pos.z };
  const pv = { x: 0, y: 0, z: 0 };
  const blocked = resolveCollision(probe, pv, BALANCE.playerRadius * m.scale, MAP.boxes, BALANCE.playerHeight * m.scale) && probe.y < m.pos.y - 0.01;
  if (!blocked) m.crouching = false;
}

/** Um passo de simulação. Determinístico: mesma entrada, mesmo resultado nos dois lados. */
export function stepMovement(m: MoverState, input: MoveInput, dt: number) {
  updateCrouch(m, input.crouch);

  const sin = Math.sin(m.yaw);
  const cos = Math.cos(m.yaw);
  const fx = -sin * input.moveY + cos * input.moveX;
  const fz = -cos * input.moveY - sin * input.moveX;
  const len = Math.hypot(fx, fz) || 1;
  const crouchMult = m.crouching ? BALANCE.crouchSpeedMult : 1;
  const speed = BALANCE.baseSpeed * m.speedMult * m.buffSpeed * crouchMult;
  const targetVx = (fx / len) * speed;
  const targetVz = (fz / len) * speed;
  const accel = m.onGround ? GROUND_ACCEL : AIR_ACCEL;
  const k = Math.min(1, accel * dt);
  m.vel.x += (targetVx - m.vel.x) * k;
  m.vel.z += (targetVz - m.vel.z) * k;

  if (input.jump && m.onGround && !m.crouching) {
    m.vel.y = BALANCE.jumpVel / Math.sqrt(m.gravityMult);
  }
  m.vel.y -= BALANCE.gravity * m.gravityMult * dt;
  if (m.vel.y < -30) m.vel.y = -30;

  m.pos.x += m.vel.x * dt;
  m.pos.y += m.vel.y * dt;
  m.pos.z += m.vel.z * dt;

  const wasAbove = m.pos.y > 0.05;
  const hit = resolveCollision(m.pos, m.vel, BALANCE.playerRadius * m.scale, MAP.boxes, moverHeight(m));
  m.onGround = m.pos.y <= 0.01 || (wasAbove && hit && m.vel.y <= 0);
  if (m.onGround) m.vel.y = 0;
}
