import * as THREE from "three";
import type { Team } from "../../shared/protocol";
import { makeWeaponModel, weaponMeta } from "./models/weapons";
import { getWeaponModel } from "./models/gltf";
import { disposeTree } from "./dispose";
import { WEAPONS } from "../../shared/weapons";
import { makeArmsRig, type ArmsRig } from "./models/arms";
import { IS_MOBILE, smokeTexture, tex } from "./textures";

// ===== Arma em primeira pessoa: braços + arma presos na câmera =====

const BASE = { x: 0.16, y: -0.17, z: -0.5 };
/** Ajuste fino por arma quando o GLB está carregado (posição do holder e escala). */
const VM_OFFSET: Record<string, { x: number; y: number; z: number; s: number; ry: number }> = {
  ak47: { x: 0.17, y: -0.2, z: -0.34, s: 0.42, ry: 0.02 },
  m4a1: { x: 0.17, y: -0.2, z: -0.34, s: 0.42, ry: 0.02 },
  awp: { x: 0.17, y: -0.2, z: -0.32, s: 0.4, ry: 0.0 },
  mp5: { x: 0.17, y: -0.2, z: -0.34, s: 0.46, ry: 0.03 },
  xm1014: { x: 0.17, y: -0.2, z: -0.34, s: 0.42, ry: 0.02 },
  m3: { x: 0.17, y: -0.2, z: -0.34, s: 0.42, ry: 0.02 },
  m249: { x: 0.17, y: -0.21, z: -0.34, s: 0.42, ry: 0.02 },
  deagle: { x: 0.15, y: -0.18, z: -0.32, s: 0.5, ry: 0.02 },
  usp: { x: 0.15, y: -0.18, z: -0.32, s: 0.5, ry: 0.02 },
  glock: { x: 0.15, y: -0.18, z: -0.32, s: 0.5, ry: 0.02 },
  knife: { x: 0.16, y: -0.17, z: -0.3, s: 0.6, ry: 0.25 },
};

export interface VmFrame {
  moving: boolean;
  reloading: boolean;
  alive: boolean;
  speed: number;
  zoomed: boolean;
  /** Variação de yaw/pitch neste frame (rad) — alimenta o balanço/inércia. */
  lookDYaw: number;
  lookDPitch: number;
  /** -1..1 (esquerda/direita) e (trás/frente) do input de movimento. */
  strafe: number;
  forward: number;
  airborne: boolean;
}

const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Viewmodel {
  private holder: THREE.Group | null = null;
  private weaponId = "";
  private isMelee = false;
  private recoil = 0;
  private bob = 0;
  private raise = 0; // animação de sacar
  private muzzle: THREE.Mesh | null = null;
  private muzzleGlow: THREE.Sprite | null = null;
  private muzzleLight: THREE.PointLight | null = null;
  private muzzleUntil = 0;
  private shells: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: number; until: number }[] = [];
  private shellMat = new THREE.MeshStandardMaterial({ color: 0xc9a04a, metalness: 0.8, roughness: 0.35 });
  private shellGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.022, 5);
  private base = { ...BASE };
  private arms: ArmsRig | null = null;
  private armKey = "";
  private len = 0.9;
  private pistol = false;
  private sway = { x: 0, y: 0, vx: 0, vy: 0 };
  private sprint = 0;
  private lean = 0;
  private landDip = 0;
  private wasAirborne = false;
  private reloadT = 0;
  private reloadHand: THREE.Vector3 | null = null;
  private magMesh: THREE.Group | null = null;
  private smoke: { sprite: THREE.Sprite; vel: THREE.Vector3; born: number; life: number }[] = [];
  private smokeMat: THREE.SpriteMaterial | null = null;
  hidden = false;

  /** `camera` é a câmera do viewmodel (passe próprio, FOV fixo, depth limpo): a arma nunca atravessa paredes. */
  constructor(private worldCamera: THREE.PerspectiveCamera, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {}

  set(weaponId: string, team: Team, classId = "") {
    const id = team === "zombie" ? "claws" : weaponId;
    const key = `${id}|${classId}`;
    if (this.holder && this.armKey === key) return;
    this.armKey = key;
    if (this.arms) {
      this.camera.remove(this.arms.root);
      disposeTree(this.arms.root);
      this.arms = null;
    }
    if (this.holder) {
      this.camera.remove(this.holder);
      disposeTree(this.holder);
      this.holder = null;
      this.muzzle = null;
      this.muzzleGlow = null;
      this.muzzleLight = null;
    }
    this.weaponId = id;
    this.isMelee = id === "claws" || id === "knife";
    this.raise = 1;

    const holder = new THREE.Group();

    this.arms = makeArmsRig(classId, team === "zombie", team === "zombie" ? 0.9 : 0.6);
    if (this.arms) {
      // Ombros logo abaixo/atrás da câmera: o espaço do modelo tem o ombro a ~(0, 1,45, 0,065)·escala
      this.arms.root.position.set(0.12, -0.42 - 1.45 * this.arms.scale, -0.2 - 0.065 * this.arms.scale);
      this.camera.add(this.arms.root);
    }
    if (id === "claws") {
      if (this.arms) {
        // Garras presas aos ossos da mão: seguem a pose do braço
        for (const side of ["L", "R"] as const) {
          const claws = makeWeaponModel("claws");
          const holderClaw = new THREE.Group();
          holderClaw.rotation.x = Math.PI / 2;
          holderClaw.position.y = 0.075;
          holderClaw.scale.setScalar(0.3);
          holderClaw.add(claws);
          const hand = this.arms.hand(side);
          this.arms.root.updateMatrixWorld(true);
          const ws = new THREE.Vector3();
          hand.getWorldScale(ws);
          const wrap = new THREE.Group();
          wrap.scale.setScalar(1 / (ws.x || 1));
          wrap.add(holderClaw);
          hand.add(wrap);
        }
      }
    } else {
      const gun = makeWeaponModel(id);
      holder.add(gun);
      this.pistol = id === "deagle" || id === "usp" || id === "glock";
      const loaded = getWeaponModel(id);
      const off = loaded ? VM_OFFSET[id] : undefined;
      this.len = loaded ? loaded.box.max.z - loaded.box.min.z : 0.8;
      if (id === "knife") this.arms?.hide("L", true);
      this.magMesh = null;
      if (this.arms && id !== "knife") {
        // Carregador de mentira, preso à mão esquerda, que aparece só durante a recarga
        const hand = this.arms.hand("L");
        const mag = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.035, this.pistol ? 0.1 : 0.15, 0.07), new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.6, roughness: 0.5 }));
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.06), new THREE.MeshStandardMaterial({ color: 0xc9a04a, metalness: 0.8, roughness: 0.35 }));
        top.position.y = this.pistol ? 0.056 : 0.081;
        mag.add(body, top);
        mag.position.set(0, 0.07, 0.0);
        mag.visible = false;
        const wrap = new THREE.Group();
        this.arms.root.updateMatrixWorld(true);
        const ws = new THREE.Vector3();
        hand.getWorldScale(ws);
        wrap.scale.setScalar(1 / (ws.x || 1));
        wrap.add(mag);
        hand.add(wrap);
        this.magMesh = mag;
      }
      holder.scale.setScalar(off?.s ?? 0.5);
      this.base = off ? { x: off.x, y: off.y, z: off.z } : { ...BASE };
      holder.position.set(this.base.x, this.base.y, this.base.z);
      holder.rotation.set(0.03, off?.ry ?? 0.06, 0);

      if (id !== "knife") {
        const meta = weaponMeta(id);
        const flashGeo = new THREE.ConeGeometry(0.09, 0.3, 6);
        flashGeo.rotateX(-Math.PI / 2);
        const flash = new THREE.Mesh(
          flashGeo,
          new THREE.MeshBasicMaterial({ color: 0xffd27f, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
        );
        flash.position.set(0, meta.muzzleY, meta.muzzleZ - 0.12);
        flash.visible = false;
        holder.add(flash);
        this.muzzle = flash;
        // Clarão em billboard — sempre visível, independente do ângulo do cano
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex("smoke", smokeTexture), color: 0xffb040, transparent: true, opacity: 0.95, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
        glow.position.set(0, meta.muzzleY, meta.muzzleZ - 0.05);
        glow.scale.setScalar(0.5);
        glow.visible = false;
        holder.add(glow);
        this.muzzleGlow = glow;
        const light = new THREE.PointLight(0xffb457, 0, 10);
        light.position.copy(flash.position);
        holder.add(light);
        this.muzzleLight = light;
      }
    }
    holder.traverse((o) => { if (o instanceof THREE.Mesh) o.renderOrder = 10; });
    this.holder = holder;
    this.camera.add(holder);
  }

  fire() {
    this.recoil = 1;
    if (this.muzzle) {
      this.muzzle.visible = true;
      this.muzzle.rotation.z = Math.random() * Math.PI;
      this.muzzle.scale.setScalar(0.8 + Math.random() * 0.5);
      this.muzzleUntil = performance.now() + 55;
    }
    if (this.muzzleGlow) {
      this.muzzleGlow.visible = true;
      this.muzzleGlow.scale.setScalar(0.4 + Math.random() * 0.3);
    }
    if (this.muzzleLight) this.muzzleLight.intensity = 8;
    if (!IS_MOBILE && weaponMeta(this.weaponId).shells) this.ejectShell();
    if (!IS_MOBILE) this.puff();
  }

  startReload() {
    this.reloadT = 0.001; // a animação anda sozinha enquanto o servidor diz que está recarregando
  }

  switchAnim() {
    this.raise = 1;
  }

  private ejectShell() {
    const mesh = new THREE.Mesh(this.shellGeo, this.shellMat);
    // Sai da janela de ejeção (à direita da arma) no espaço do mundo
    const origin = new THREE.Vector3(0.22, -0.12, -0.35).applyMatrix4(this.camera.matrixWorld);
    mesh.position.copy(origin);
    const right = new THREE.Vector3(1, 0.4, 0).applyQuaternion(this.camera.quaternion);
    this.scene.add(mesh);
    this.shells.push({
      mesh,
      vel: right.multiplyScalar(2.4 + Math.random()).add(new THREE.Vector3(0, 1.0, 0)),
      spin: (Math.random() - 0.5) * 20,
      until: performance.now() + 900,
    });
  }

  update(dt: number, f: VmFrame) {
    const nowMs = performance.now();
    this.shells = this.shells.filter((s) => {
      if (nowMs > s.until) { this.scene.remove(s.mesh); return false; }
      s.vel.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin * dt;
      s.mesh.rotation.z += s.spin * 0.7 * dt;
      return true;
    });
    this.smoke = this.smoke.filter((p) => {
      const age = (nowMs - p.born) / p.life;
      if (age >= 1) { this.scene.remove(p.sprite); p.sprite.material.dispose(); return false; }
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 1.5);
      p.sprite.scale.setScalar(0.08 + age * 0.5);
      p.sprite.material.opacity = 0.32 * (1 - age) * (1 - age);
      return true;
    });

    const vm = this.holder;
    if (!vm) return;
    vm.visible = f.alive && !f.zoomed && !this.hidden;
    if (this.arms) this.arms.root.visible = vm.visible;
    if (!vm.visible) return;
    const w = WEAPONS[this.weaponId];
    const melee = this.isMelee;
    const claws = this.weaponId === "claws";

    this.bob += dt * (f.moving ? 5.5 + f.speed * 0.7 : 1.6);
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.raise = Math.max(0, this.raise - dt * 3.5);

    // --- Recarga em fases (progresso 0..1 no tempo real da arma) ---
    const reloadTime = Math.max(0.8, (w?.reloadTime ?? 2.2) * 0.92);
    if (f.reloading && !melee) this.reloadT = Math.min(1, this.reloadT + dt / reloadTime);
    else this.reloadT = 0;
    const p = this.reloadT;
    const tilt = smooth(p, 0, 0.15) * (1 - smooth(p, 0.82, 0.97));
    this.updateReloadHand(p);

    // --- Corrida: arma baixa e inclinada ---
    const wantSprint = f.speed > 5.6 && f.forward > 0.5 && !f.reloading && !f.airborne ? 1 : 0;
    this.sprint += (wantSprint - this.sprint) * Math.min(1, dt * 9);

    // --- Inércia da mira: mola amortecida atrás do movimento do mouse ---
    const rateY = Math.max(-14, Math.min(14, f.lookDYaw / Math.max(dt, 1e-3)));
    const rateP = Math.max(-14, Math.min(14, f.lookDPitch / Math.max(dt, 1e-3)));
    const sw = this.sway;
    const k = 190, c = 19;
    // Integração em passos pequenos: a mola é rígida e explodiria com dt grande (aba em segundo plano, GPU lenta)
    const steps = Math.max(1, Math.min(8, Math.ceil(dt / (1 / 120))));
    const h = Math.min(dt, 0.1) / steps;
    for (let i = 0; i < steps; i++) {
      sw.vx += (k * (-rateY * 0.0042 - sw.x) - c * sw.vx) * h;
      sw.vy += (k * (rateP * 0.0042 - sw.y) - c * sw.vy) * h;
      sw.x += sw.vx * h;
      sw.y += sw.vy * h;
    }
    sw.x = Math.max(-0.06, Math.min(0.06, sw.x));
    sw.y = Math.max(-0.06, Math.min(0.06, sw.y));

    // --- Inclinação ao andar de lado e impacto ao pousar ---
    this.lean += (-f.strafe * 0.05 - this.lean) * Math.min(1, dt * 8);
    if (this.wasAirborne && !f.airborne) this.landDip = 1;
    this.wasAirborne = f.airborne;
    this.landDip = Math.max(0, this.landDip - dt * 5);
    const airLift = f.airborne ? 0.018 : 0;

    const speedK = Math.min(1, f.speed / 6.6);
    const bobAmp = f.moving ? 0.006 + speedK * 0.016 : 0.0035;
    const bx = Math.sin(this.bob) * bobAmp * (1 + this.sprint);
    const by = Math.abs(Math.cos(this.bob)) * bobAmp * 0.9 * (1 + this.sprint * 0.5);
    const baseX = claws ? 0 : this.base.x;
    const baseY = claws ? 0 : this.base.y;
    const baseZ = claws ? 0 : this.base.z;
    const reloadDip = tilt * 0.05;
    const raiseDip = this.raise * this.raise * 0.35;
    const sp = this.sprint;
    vm.position.set(
      baseX + bx + sw.x - sp * 0.07 + tilt * -0.03,
      baseY + by + sw.y - this.landDip * 0.04 + airLift - reloadDip - raiseDip - sp * 0.06,
      baseZ + (melee ? -this.recoil * 0.3 : this.recoil * 0.07) + sp * 0.03,
    );
    const baseRy = melee ? (this.weaponId === "knife" ? VM_OFFSET.knife.ry : 0) : VM_OFFSET[this.weaponId] && getWeaponModel(this.weaponId) ? VM_OFFSET[this.weaponId].ry : 0.06;
    vm.rotation.set(
      (melee ? 0 : 0.03) + this.recoil * (melee ? -0.35 : 0.22) + tilt * 0.45 + raiseDip * 1.5 + sw.y * 1.6 - sp * 0.3 + this.landDip * 0.06,
      baseRy + tilt * 0.35 - sw.x * 1.6 + sp * 0.6,
      this.recoil * 0.05 + tilt * 0.35 + this.lean + sp * 0.28 + sw.x * 1.2 + Math.sin(this.bob * 0.5) * bobAmp * 0.8,
    );

    this.poseArms();

    if (this.muzzle && this.muzzle.visible && nowMs > this.muzzleUntil) {
      this.muzzle.visible = false;
      if (this.muzzleGlow) this.muzzleGlow.visible = false;
      if (this.muzzleLight) this.muzzleLight.intensity = 0;
    }
  }

  /** Mão esquerda: alça → boca do carregador → solta o velho → pega o novo → encaixa → volta. */
  private updateReloadHand(p: number) {
    if (p <= 0 || this.isMelee) {
      this.reloadHand = null;
      if (this.magMesh) this.magMesh.visible = false;
      return;
    }
    const mag = new THREE.Vector3(0, -0.13, -0.05);
    const drop = new THREE.Vector3(-0.08, -0.5, 0.0);
    const fresh = new THREE.Vector3(-0.06, -0.34, -0.07);
    const home = this.pistol ? new THREE.Vector3(-0.025, -0.075, 0.03) : new THREE.Vector3(0, -0.03, -this.len * 0.28);
    const out = new THREE.Vector3();
    if (p < 0.18) out.lerpVectors(home, mag, smooth(p, 0, 0.18));
    else if (p < 0.38) out.lerpVectors(mag, drop, smooth(p, 0.18, 0.38));
    else if (p < 0.52) out.lerpVectors(drop, fresh, smooth(p, 0.38, 0.52));
    else if (p < 0.74) out.lerpVectors(fresh, mag, smooth(p, 0.52, 0.74));
    else out.lerpVectors(mag, home, smooth(p, 0.74, 0.95));
    this.reloadHand = out;
    if (this.magMesh) this.magMesh.visible = (p > 0.24 && p < 0.4) || (p > 0.44 && p < 0.72);
  }

  /** Fumaça subindo do cano depois do tiro (no mundo, para não acompanhar a mão). */
  private puff() {
    if (!this.muzzle || !this.holder || this.smoke.length > 10) return;
    this.smokeMat ??= new THREE.SpriteMaterial({ map: tex("smoke", smokeTexture), color: 0xb9b2a4, transparent: true, depthWrite: false, opacity: 0.3 });
    const pos = this.muzzle.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.worldCamera.matrixWorld);
    const sprite = new THREE.Sprite(this.smokeMat.clone());
    sprite.position.copy(pos);
    this.scene.add(sprite);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.worldCamera.quaternion);
    this.smoke.push({ sprite, vel: fwd.multiplyScalar(0.5).add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.3, (Math.random() - 0.5) * 0.15)), born: performance.now(), life: 650 + Math.random() * 250 });
  }

  /** Leva as mãos do soldado até as empunhaduras da arma (ou às garras do zumbi) a cada frame. */
  private poseArms() {
    const arms = this.arms;
    const holder = this.holder;
    if (!arms || !holder) return;
    holder.updateMatrix();
    const q = holder.quaternion;
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const toCam = (p: THREE.Vector3) => p.applyMatrix4(holder.matrix);
    const dir = (d: THREE.Vector3) => d.applyQuaternion(q);
    if (this.weaponId === "claws") {
      const t = this.bob;
      for (const side of ["L", "R"] as const) {
        const k = side === "R" ? 1 : -1;
        // Golpe: a mão avança e cruza o campo de visão
        const sw = this.recoil;
        const target = v(k * (0.2 - sw * 0.18), -0.2 + sw * 0.06 + Math.sin(t + k) * 0.01, -0.46 - sw * 0.26);
        arms.reach(side, target, v(k * -0.1, -0.1, -1), v(k * -0.3, -1, 0), v(k * 0.6, -1, 0.2), 0.55);
      }
      return;
    }
    const grip = this.pistol;
    arms.reach("R", toCam(v(0.0, -0.045, 0.035)), dir(v(0, -0.3, -0.95)), dir(v(-1, 0, 0)), dir(v(0.6, -1, 0.25)), 1.15);
    if (this.weaponId === "knife") return;
    const rl = this.reloadHand;
    if (rl) {
      // Durante a recarga a mão aberta busca o carregador (curl menor)
      arms.reach("L", toCam(rl.clone()), dir(v(0.1, 0.05, -1)), dir(v(0, 1, 0)), dir(v(-0.5, -1, 0.25)), 0.45);
    } else if (grip) arms.reach("L", toCam(v(-0.025, -0.075, 0.03)), dir(v(0, -0.55, -0.8)), dir(v(1, 0, 0)), dir(v(-0.6, -1, 0.25)), 1.0);
    else arms.reach("L", toCam(v(0.0, -0.03, -this.len * 0.28)), dir(v(0, 0.05, -1)), dir(v(0, 1, 0)), dir(v(-0.5, -1, 0.25)), 0.75);
  }
}
