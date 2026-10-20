import { makeBody, stepBody, type BounceBody } from "../../shared/bounce";
import { MAP } from "../../shared/map";
import type { Vec3 } from "../../shared/protocol";

// ===== Cadáver com física: é empurrado pelo golpe/explosão, desliza, bate em paredes e tomba na direção do impacto =====

const RADIUS = 0.3;
const FALL_TIME = 0.55;

export class CorpsePhysics {
  private body: BounceBody;
  private age = 0;
  /** Direção horizontal da queda (unitária). */
  readonly dir = { x: 0, z: 1 };

  constructor(pos: Vec3, vel: Vec3, impulse: Vec3, yaw: number) {
    const vx = vel.x * 0.9 + impulse.x;
    const vz = vel.z * 0.9 + impulse.z;
    this.body = makeBody({ x: pos.x, y: pos.y + RADIUS + 0.05, z: pos.z }, { x: vx, y: Math.max(vel.y, 0) + 1.2 + impulse.y, z: vz }, {
      radius: RADIUS,
      restitution: 0.15,
      friction: 0.35,
      rolling: 3.2,
    });
    const h = Math.hypot(vx, vz);
    if (h > 0.5) {
      this.dir.x = vx / h;
      this.dir.z = vz / h;
    } else {
      // Sem empurrão: cai para trás (o boneco olha para -z local, yaw gira ao redor de y)
      this.dir.x = Math.sin(yaw);
      this.dir.z = Math.cos(yaw);
    }
  }

  step(dt: number) {
    this.age += dt;
    stepBody(this.body, Math.min(dt, 1 / 30), MAP.boxes, 20);
  }

  /** Pés do cadáver no mundo. */
  get x(): number { return this.body.pos.x; }
  get z(): number { return this.body.pos.z; }
  get y(): number { return Math.max(0, this.body.pos.y - RADIUS); }

  /** 0 (em pé) → 1 (deitado), com easing de queda. */
  get fall(): number {
    const t = Math.min(1, this.age / FALL_TIME);
    return 1 - (1 - t) * (1 - t);
  }

  /** Yaw que faz a rotação em X tombar o boneco ao longo de `dir`. */
  get fallYaw(): number {
    return Math.atan2(this.dir.x, this.dir.z);
  }

  get speed(): number {
    return Math.hypot(this.body.vel.x, this.body.vel.z);
  }
}
