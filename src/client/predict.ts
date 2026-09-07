import type { PlayerState, Vec3 } from "../shared/protocol";
import { stepMovement, type MoverState, type MoveInput } from "../shared/movement";

// ===== Predição local do próprio jogador: anda no frame, o servidor corrige depois =====

/** Acima disso o servidor discorda demais (teleporte, knockback forte): pula para a posição dele. */
export const SNAP_DISTANCE = 2.5;
/** Fração do erro corrigida por frame (a 60 fps some em ~150 ms sem tranco). */
export const CORRECTION_RATE = 0.15;
/** Diferença que cabe na latência e no arredondamento: não corrige. */
export const TOLERANCE = 0.08;
/** Quanto rastro guardar para casar o snapshot atrasado (cobre ping alto). */
const HISTORY_MS = 400;

export interface Reconciled {
  pos: Vec3;
  snapped: boolean;
}

/** Puro: aproxima a posição predita da posição do servidor. */
export function reconcilePosition(predicted: Vec3, server: Vec3, rate = CORRECTION_RATE, snap = SNAP_DISTANCE): Reconciled {
  const dx = server.x - predicted.x;
  const dy = server.y - predicted.y;
  const dz = server.z - predicted.z;
  const err = Math.hypot(dx, dy, dz);
  if (err > snap || err < 1e-4) return { pos: { x: server.x, y: server.y, z: server.z }, snapped: err > snap };
  return { pos: { x: predicted.x + dx * rate, y: predicted.y + dy * rate, z: predicted.z + dz * rate }, snapped: false };
}

export class Predictor {
  readonly mover: MoverState = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    onGround: true,
    crouching: false,
    yaw: 0,
    speedMult: 1,
    buffSpeed: 1,
    gravityMult: 1,
    scale: 1,
  };
  private initialized = false;
  /** Erro pendente entre predito e servidor, drenado aos poucos a cada frame. */
  private pendingError = { x: 0, y: 0, z: 0 };
  private lastServerSpeed = 0;
  /** Rastro recente da predição: o snapshot do servidor chega atrasado e é comparado com onde eu estava, não com onde estou. */
  private history: { t: number; x: number; y: number; z: number }[] = [];

  /** Um frame de simulação local. */
  step(input: MoveInput, yaw: number, dt: number) {
    if (!this.initialized) return;
    this.mover.yaw = yaw;
    stepMovement(this.mover, input, dt);
    // Drena a correção suavemente para não dar tranco
    const k = Math.min(1, CORRECTION_RATE * (dt * 60));
    this.mover.pos.x += this.pendingError.x * k;
    this.mover.pos.y += this.pendingError.y * k;
    this.mover.pos.z += this.pendingError.z * k;
    this.pendingError.x *= 1 - k;
    this.pendingError.y *= 1 - k;
    this.pendingError.z *= 1 - k;
    const nowMs = performance.now();
    this.history.push({ t: nowMs, x: this.mover.pos.x, y: this.mover.pos.y, z: this.mover.pos.z });
    while (this.history.length > 0 && nowMs - this.history[0].t > HISTORY_MS) this.history.shift();
  }

  /** Ponto do rastro recente mais próximo da posição do servidor (a latência explica a diferença, não um erro). */
  private closestOnPath(server: Vec3): { x: number; y: number; z: number } | null {
    let best: { x: number; y: number; z: number } | null = null;
    let bestD = Infinity;
    for (const h of this.history) {
      const d = Math.hypot(h.x - server.x, h.y - server.y, h.z - server.z);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    return best;
  }

  /** Chamado a cada snapshot com o estado autoritativo do próprio jogador. */
  reconcile(me: PlayerState) {
    const m = this.mover;
    m.speedMult = me.speedMult;
    m.gravityMult = 1;
    m.scale = me.scale;
    // Buffs não vêm no snapshot: infere pela velocidade que o servidor reporta
    const base = 6.6 * me.speedMult * (me.crouching ? 0.45 : 1);
    this.lastServerSpeed = me.speed;
    m.buffSpeed = me.speed > base * 1.08 ? Math.min(1.6, me.speed / base) : 1;

    if (!this.initialized || !me.alive) {
      m.pos.x = me.pos.x; m.pos.y = me.pos.y; m.pos.z = me.pos.z;
      m.vel.x = me.vel?.x ?? 0; m.vel.y = me.vel?.y ?? 0; m.vel.z = me.vel?.z ?? 0;
      m.crouching = me.crouching;
      this.pendingError.x = this.pendingError.y = this.pendingError.z = 0;
      this.initialized = true;
      return;
    }
    // Compara com o ponto do meu rastro mais próximo: se o servidor está "no meu caminho", não há erro
    const ref = this.closestOnPath(me.pos) ?? m.pos;
    const r = reconcilePosition(ref, me.pos);
    if (r.snapped) {
      m.pos.x = me.pos.x; m.pos.y = me.pos.y; m.pos.z = me.pos.z;
      if (me.vel) { m.vel.x = me.vel.x; m.vel.y = me.vel.y; m.vel.z = me.vel.z; }
      this.pendingError.x = this.pendingError.y = this.pendingError.z = 0;
      this.history.length = 0;
      return;
    }
    const ex = me.pos.x - ref.x;
    const ey = me.pos.y - ref.y;
    const ez = me.pos.z - ref.z;
    if (Math.hypot(ex, ey, ez) < TOLERANCE) {
      this.pendingError.x = this.pendingError.y = this.pendingError.z = 0;
    } else {
      this.pendingError.x = ex;
      this.pendingError.y = ey;
      this.pendingError.z = ez;
    }
    // Knockback/pulo do servidor: se a velocidade dele diverge muito, adota
    if (me.vel) {
      const dv = Math.hypot(me.vel.x - m.vel.x, me.vel.y - m.vel.y, me.vel.z - m.vel.z);
      if (dv > 4) { m.vel.x = me.vel.x; m.vel.y = me.vel.y; m.vel.z = me.vel.z; }
    }
  }

  get pos(): Vec3 {
    return this.mover.pos;
  }

  get speed(): number {
    return this.initialized ? Math.hypot(this.mover.vel.x, this.mover.vel.z) : this.lastServerSpeed;
  }

  get airborne(): boolean {
    return this.initialized && !this.mover.onGround && this.mover.pos.y > 0.15;
  }
}
