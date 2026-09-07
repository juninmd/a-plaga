import * as THREE from "three";
import type { PlayerState, Team } from "../../shared/protocol";
import { makeHumanModel, type BuiltModel } from "./models/human";
import { makeZombieModel } from "./models/zombie";
import { IS_MOBILE } from "./textures";
import { disposeTree } from "./dispose";

// ===== Registro dos bonecos dos outros jogadores: animação, agachar, morte, name tag =====

interface RenderedPlayer extends BuiltModel {
  team: Team;
  classId: string;
  weapon: string;
  target: PlayerState;
  nameTag: THREE.Sprite;
  glow: THREE.Mesh;
  curScale: number;
  walkPhase: number;
  crouch: number; // 0..1 suavizado
  swing: number; // animação de golpe (0..1)
  lastLabel: string;
  lastColor: number;
  /** Momento (ms) da morte; corpo cai e some depois. */
  diedAt: number;
  alive: boolean;
}

const CORPSE_MS = 8000;

export class PlayerRegistry {
  private players = new Map<number, RenderedPlayer>();
  localId = -1;
  private localTeam: Team = "human";

  constructor(private scene: THREE.Scene, private clock: THREE.Clock) {}

  ids(): number[] {
    return [...this.players.keys()];
  }

  private build(p: PlayerState): RenderedPlayer {
    const built = p.team === "zombie" ? makeZombieModel(p.color, p.classId) : makeHumanModel(p.color, p.classId, p.weapon);
    const group = built.group;
    if (!IS_MOBILE) group.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x00e676, transparent: true, opacity: 0, depthWrite: false }),
    );
    glow.position.y = 0.9;
    group.add(glow);

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    const nameTag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    nameTag.scale.set(1.6, 0.4, 1);
    nameTag.position.y = 2.15;
    group.add(nameTag);

    this.scene.add(group);
    return {
      ...built,
      team: p.team,
      classId: p.classId,
      weapon: p.weapon,
      target: p,
      nameTag,
      glow,
      curScale: p.scale,
      walkPhase: Math.random() * 6,
      crouch: 0,
      swing: 0,
      lastLabel: "",
      lastColor: -1,
      diedAt: 0,
      alive: p.alive,
    };
  }

  upsert(p: PlayerState) {
    if (p.id === this.localId) this.localTeam = p.team;
    let rp = this.players.get(p.id);
    // Reconstrói quando time/classe/arma mudam — mas não em cima de um cadáver (a troca acontece no respawn)
    if (rp && (rp.team !== p.team || rp.classId !== p.classId || rp.weapon !== p.weapon) && p.alive) {
      this.destroy(rp);
      this.players.delete(p.id);
      rp = undefined;
    }
    if (!rp) {
      rp = this.build(p);
      this.players.set(p.id, rp);
      rp.group.position.set(p.pos.x, p.pos.y, p.pos.z);
    }
    rp.target = p;
    if (rp.alive && !p.alive) rp.diedAt = performance.now();
    if (!rp.alive && p.alive) {
      // Respawn: reseta a pose do cadáver
      rp.diedAt = 0;
      rp.group.rotation.set(0, p.yaw, 0);
      rp.group.position.set(p.pos.x, p.pos.y, p.pos.z);
      for (const m of rp.fadeable) { m.transparent = false; m.opacity = 1; }
    }
    rp.alive = p.alive;

    if (rp.lastColor !== p.color) {
      rp.lastColor = p.color;
      const base = new THREE.Color(p.color);
      if (p.team === "zombie") rp.tinted[0]?.color.copy(base.clone().multiplyScalar(0.35));
      else {
        rp.tinted[0]?.color.copy(base.clone().lerp(new THREE.Color(0xffffff), 0.35));
        rp.tinted[1]?.color.copy(base.clone().multiplyScalar(0.45));
      }
    }

    if (p.alive) {
      const invisible = p.invisible;
      for (const m of rp.fadeable) {
        if (m.transparent !== invisible) { m.transparent = invisible; m.needsUpdate = true; }
        m.opacity = invisible ? 0.15 : 1;
      }
    }

    const glowMat = rp.glow.material as THREE.MeshBasicMaterial;
    if (p.isBoss) {
      glowMat.opacity = 0.22 + Math.sin(this.clock.elapsedTime * 4) * 0.1;
      glowMat.color.setHex(p.team === "zombie" ? 0xff1744 : 0x29b6f6);
    } else if (p.team === "zombie") {
      glowMat.opacity = 0.07;
      glowMat.color.setHex(0x00e676);
    } else glowMat.opacity = 0;

    // Name tag: nome + barra de HP (só para aliados do jogador local) — redesenha só quando muda
    const ally = p.team === this.localTeam;
    const hpBucket = ally ? Math.round((p.hp / Math.max(1, p.maxHp)) * 20) : -1;
    const label = `${p.isBoss ? "★ " : ""}${p.name}|${p.team}|${hpBucket}`;
    if (rp.lastLabel !== label) {
      rp.lastLabel = label;
      const canvas = rp.nameTag.material.map!.image as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = "bold 26px sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = p.isBoss ? "#ffd54f" : p.team === "zombie" ? "#8fe58f" : "#8fd3ff";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 6;
      ctx.fillText(`${p.isBoss ? "★ " : ""}${p.name}`, 128, 30);
      if (hpBucket >= 0) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(68, 40, 120, 9);
        ctx.fillStyle = hpBucket > 8 ? "#4caf50" : hpBucket > 4 ? "#ffb300" : "#e53935";
        ctx.fillRect(69, 41, (118 * hpBucket) / 20, 7);
      }
      rp.nameTag.material.map!.needsUpdate = true;
    }
  }

  remove(id: number) {
    const rp = this.players.get(id);
    if (rp) {
      this.destroy(rp);
      this.players.delete(id);
    }
  }

  /** Cada modelo tem geometrias, materiais e a textura do nome próprios — sem isso a troca de arma vaza GPU. */
  private destroy(rp: RenderedPlayer) {
    this.scene.remove(rp.group);
    disposeTree(rp.group);
    rp.nameTag.material.map?.dispose();
  }

  meleeSwing(id: number) {
    const rp = this.players.get(id);
    if (rp) rp.swing = 1;
  }

  update(dt: number) {
    const nowMs = performance.now();
    for (const rp of this.players.values()) {
      const p = rp.target;
      const isLocal = p.id === this.localId;
      if (!p.alive && rp.diedAt > 0) {
        this.animateCorpse(rp, nowMs - rp.diedAt, isLocal);
        continue;
      }
      rp.group.visible = p.alive && !isLocal;
      rp.nameTag.visible = rp.group.visible;
      if (!rp.group.visible) continue;

      const lerp = 1 - Math.exp(-12 * dt);
      rp.group.position.x += (p.pos.x - rp.group.position.x) * lerp;
      rp.group.position.z += (p.pos.z - rp.group.position.z) * lerp;
      rp.group.position.y += (p.pos.y - rp.group.position.y) * Math.min(1, lerp * 2);
      rp.curScale += (p.scale - rp.curScale) * lerp;
      rp.group.scale.setScalar(rp.curScale);
      rp.group.rotation.y = p.yaw;

      // Ciclo de caminhada pela velocidade real informada pelo servidor
      const speed = p.speed ?? 0;
      const amp = Math.min(0.7, speed * 0.1);
      rp.walkPhase += dt * (3 + speed * 1.9);
      const swing = Math.sin(rp.walkPhase) * amp;
      rp.crouch += ((p.crouching ? 1 : 0) - rp.crouch) * Math.min(1, dt * 10);
      const c = rp.crouch;
      rp.legL.rotation.x = swing - c * 1.1;
      rp.legR.rotation.x = -swing - c * 1.1;
      rp.shinL.rotation.x = Math.max(0, -swing) * 0.8 + c * 1.5 + (p.team === "zombie" ? 0.5 : 0);
      rp.shinR.rotation.x = Math.max(0, swing) * 0.8 + c * 1.5 + (p.team === "zombie" ? 0.5 : 0);
      rp.upper.position.y = -c * 0.45 + (p.team === "zombie" ? Math.abs(Math.sin(rp.walkPhase)) * 0.04 : Math.abs(Math.sin(rp.walkPhase)) * 0.015 * amp * 10);
      rp.upper.rotation.x = c * 0.25;

      rp.swing = Math.max(0, rp.swing - dt * 4);
      const sw = Math.sin(rp.swing * Math.PI);
      if (p.team === "zombie") {
        rp.armL.rotation.x = rp.armRest.l + Math.sin(rp.walkPhase) * 0.2 - sw * 1.2;
        rp.armR.rotation.x = rp.armRest.r - Math.sin(rp.walkPhase) * 0.2 - sw * 1.2;
      } else {
        rp.armR.rotation.x = rp.armRest.r - p.pitch * 0.6 - sw * 0.8;
        rp.armL.rotation.x = rp.armRest.l - p.pitch * 0.6 + swing * 0.1;
      }
    }
  }

  /** Cai para trás, escurece e some depois de alguns segundos. */
  private animateCorpse(rp: RenderedPlayer, ms: number, isLocal: boolean) {
    if (ms > CORPSE_MS) {
      rp.group.visible = false;
      return;
    }
    rp.group.visible = !isLocal;
    rp.nameTag.visible = false;
    const t = Math.min(1, ms / 450);
    const ease = 1 - (1 - t) * (1 - t);
    rp.group.rotation.x = ease * (Math.PI / 2 - 0.12);
    rp.group.position.y = rp.target.pos.y + ease * 0.25;
    rp.legL.rotation.x = 0.3 * ease;
    rp.legR.rotation.x = -0.2 * ease;
    rp.armL.rotation.x = rp.armRest.l + ease * 1.1;
    rp.armR.rotation.x = rp.armRest.r + ease * 1.3;
    const fade = ms > CORPSE_MS - 1500 ? (CORPSE_MS - ms) / 1500 : 1;
    if (fade < 1) {
      for (const m of rp.fadeable) { m.transparent = true; m.opacity = fade; }
    }
  }
}
