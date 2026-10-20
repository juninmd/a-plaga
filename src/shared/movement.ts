import { BALANCE } from "./balance.js";
import { MAP, resolveCollision, type CollisionOut } from "./map.js";
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
  /** Jump estava pressionado no passo anterior (pulo só na borda de subida, sem auto-bhop). */
  jumpWas?: boolean;
  /** Segundos desde que deixou o chão — janela de "coyote time" para o pulo. */
  airTime?: number;
}

export interface MoveInput {
  moveX: number;
  moveY: number;
  jump: boolean;
  crouch: boolean;
}

// ===== Modelo estilo Source/GoldSrc (CS 1.6), em metros =====
// sv_accelerate/sv_airaccelerate/sv_friction ajustados para um jogo de navegador (mais ágil que o CS original).
export const GROUND_ACCEL = 10;
export const AIR_ACCEL = 12;
export const FRICTION = 6;
/** Abaixo desta velocidade a fricção usa a velocidade-piso, para parar de vez (sv_stopspeed). */
export const STOP_SPEED = 1.9;
/** Teto da componente desejada no ar (30 u/s no CS = 0,76 m/s; folga extra para controle no touch). */
export const AIR_WISH_CAP = 1.1;
/** Pulo a partir do chão limita a velocidade a este múltiplo da velocidade de corrida (anti-bhop como no CS 1.6). */
export const BHOP_CAP = 1.2;
/** Teto absoluto horizontal, em múltiplos da velocidade de corrida. */
export const MAX_SPEED_MULT = 2.2;
/** Tolerância para pular logo depois de sair de uma borda. */
export const COYOTE_TIME = 0.09;

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

/** Aceleração Source: só soma o que falta para atingir wishspeed na direção desejada. */
function accelerate(vel: Vec3, wx: number, wz: number, wishspeed: number, accel: number, dt: number, cap = wishspeed) {
  const cur = vel.x * wx + vel.z * wz;
  const add = Math.min(wishspeed, cap) - cur;
  if (add <= 0) return;
  const gain = Math.min(accel * wishspeed * dt, add);
  vel.x += wx * gain;
  vel.z += wz * gain;
}

function applyFriction(vel: Vec3, dt: number) {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 1e-4) {
    vel.x = vel.z = 0;
    return;
  }
  const drop = Math.max(speed, STOP_SPEED) * FRICTION * dt;
  const k = Math.max(0, speed - drop) / speed;
  vel.x *= k;
  vel.z *= k;
}

/** Um passo de simulação. Determinístico: mesma entrada, mesmo resultado nos dois lados. */
export function stepMovement(m: MoverState, input: MoveInput, dt: number) {
  updateCrouch(m, input.crouch);

  const sin = Math.sin(m.yaw);
  const cos = Math.cos(m.yaw);
  let fx = -sin * input.moveY + cos * input.moveX;
  let fz = -cos * input.moveY - sin * input.moveX;
  const mag = Math.hypot(fx, fz);
  const crouchMult = m.crouching ? BALANCE.crouchSpeedMult : 1;
  const runSpeed = BALANCE.baseSpeed * m.speedMult * m.buffSpeed * crouchMult;
  // wishspeed proporcional ao analógico (touch) e nunca acima do máximo
  const wishspeed = runSpeed * Math.min(1, mag);
  if (mag > 1e-6) {
    fx /= mag;
    fz /= mag;
  }

  const jumpEdge = input.jump && !m.jumpWas;
  m.jumpWas = input.jump;
  m.airTime = m.onGround ? 0 : (m.airTime ?? 0) + dt;
  const canJump = (m.onGround || (m.airTime ?? 0) < COYOTE_TIME) && !m.crouching && m.vel.y <= 0.5;

  if (jumpEdge && canJump) {
    // Pulo: sem fricção neste passo (é o que permite o bhop), com teto anti-bhop
    const hs = Math.hypot(m.vel.x, m.vel.z);
    const cap = BALANCE.baseSpeed * m.speedMult * m.buffSpeed * BHOP_CAP;
    if (hs > cap) {
      m.vel.x *= cap / hs;
      m.vel.z *= cap / hs;
    }
    m.vel.y = BALANCE.jumpVel / Math.sqrt(m.gravityMult);
    m.onGround = false;
    m.airTime = COYOTE_TIME; // gasta a janela: sem pulo duplo
    accelerate(m.vel, fx, fz, wishspeed, AIR_ACCEL, dt, AIR_WISH_CAP);
  } else if (m.onGround) {
    applyFriction(m.vel, dt);
    if (mag > 1e-6) accelerate(m.vel, fx, fz, wishspeed, GROUND_ACCEL, dt);
  } else if (mag > 1e-6) {
    accelerate(m.vel, fx, fz, wishspeed, AIR_ACCEL, dt, AIR_WISH_CAP);
  }

  // Teto absoluto (strafe-jump encadeado não pode escalar sem limite)
  const maxH = BALANCE.baseSpeed * m.speedMult * m.buffSpeed * MAX_SPEED_MULT;
  const h = Math.hypot(m.vel.x, m.vel.z);
  if (h > maxH) {
    m.vel.x *= maxH / h;
    m.vel.z *= maxH / h;
  }

  m.vel.y -= BALANCE.gravity * m.gravityMult * dt;
  if (m.vel.y < -30) m.vel.y = -30;

  m.pos.x += m.vel.x * dt;
  m.pos.y += m.vel.y * dt;
  m.pos.z += m.vel.z * dt;

  const support: CollisionOut = { ground: false };
  resolveCollision(m.pos, m.vel, BALANCE.playerRadius * m.scale, MAP.boxes, moverHeight(m), support);
  // Chão = piso ou topo de box. Encostar na lateral de uma parede não é chão.
  m.onGround = m.pos.y <= 0.01 || support.ground;
  if (m.onGround && m.vel.y < 0) m.vel.y = 0;
}
