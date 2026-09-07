import type { PlayerState, ServerSnapshot, Vec3 } from "../shared/protocol";

// ===== Interpolação de entidades: renderiza os outros ~100 ms no passado, entre dois snapshots =====

/** Atraso de renderização em segundos (dois ticks de 20 Hz). */
export const INTERP_DELAY = 0.1;
/** Extrapolação máxima quando o snapshot atrasa. */
export const MAX_EXTRAPOLATE = 0.05;
const BUFFER = 8;

export interface Pose {
  pos: Vec3;
  yaw: number;
  pitch: number;
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Interpolator {
  private snaps: ServerSnapshot[] = [];
  /** Relógio de render em tempo de servidor; avança com o dt local e é puxado para latest − delay. */
  private renderTime = -1;
  private poses = new Map<number, Pose>();

  push(snap: ServerSnapshot) {
    this.snaps.push(snap);
    if (this.snaps.length > BUFFER) this.snaps.shift();
    if (this.renderTime < 0) this.renderTime = snap.t - INTERP_DELAY;
  }

  /** Avança o relógio e atualiza as poses. Devolve o mapa id → pose (objetos reutilizados). */
  update(dt: number): Map<number, Pose> {
    const n = this.snaps.length;
    if (n === 0) return this.poses;
    const latest = this.snaps[n - 1];
    const target = latest.t - INTERP_DELAY;
    this.renderTime += dt;
    const drift = target - this.renderTime;
    // Fora da janela: pula; dentro: corrige devagar para não oscilar
    if (Math.abs(drift) > 0.25) this.renderTime = target;
    else this.renderTime += drift * Math.min(1, dt * 3);
    const rt = Math.min(this.renderTime, latest.t + MAX_EXTRAPOLATE);

    // Acha o par (a, b) com a.t <= rt < b.t
    let a = this.snaps[0];
    let b: ServerSnapshot | null = null;
    for (let i = n - 1; i >= 0; i--) {
      if (this.snaps[i].t <= rt) {
        a = this.snaps[i];
        b = this.snaps[i + 1] ?? null;
        break;
      }
    }
    const span = b ? b.t - a.t : 0;
    const t = b && span > 1e-6 ? Math.min(1.5, (rt - a.t) / span) : 0;

    const seen = new Set<number>();
    for (const pa of a.players) {
      seen.add(pa.id);
      const pb = b ? b.players.find((p) => p.id === pa.id) : undefined;
      let pose = this.poses.get(pa.id);
      if (!pose) {
        pose = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };
        this.poses.set(pa.id, pose);
      }
      // Respawn/teleporte: não desliza pelo mapa
      if (!pb || !pa.alive || !pb.alive || Math.hypot(pb.pos.x - pa.pos.x, pb.pos.z - pa.pos.z) > 8) {
        copyPose(pose, pb ?? pa);
        continue;
      }
      pose.pos.x = pa.pos.x + (pb.pos.x - pa.pos.x) * t;
      pose.pos.y = pa.pos.y + (pb.pos.y - pa.pos.y) * t;
      pose.pos.z = pa.pos.z + (pb.pos.z - pa.pos.z) * t;
      pose.yaw = lerpAngle(pa.yaw, pb.yaw, t);
      pose.pitch = pa.pitch + (pb.pitch - pa.pitch) * t;
    }
    for (const id of this.poses.keys()) if (!seen.has(id)) this.poses.delete(id);
    return this.poses;
  }
}

function copyPose(pose: Pose, p: PlayerState) {
  pose.pos.x = p.pos.x;
  pose.pos.y = p.pos.y;
  pose.pos.z = p.pos.z;
  pose.yaw = p.yaw;
  pose.pitch = p.pitch;
}
