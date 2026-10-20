import * as THREE from "three";
import type { Team } from "../../shared/protocol";
import { makeWeaponModel, weaponMeta } from "./models/weapons";
import { getWeaponModel } from "./models/gltf";
import { disposeTree } from "./dispose";
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

export class Viewmodel {
  private holder: THREE.Group | null = null;
  private weaponId = "";
  private isMelee = false;
  private recoil = 0;
  private bob = 0;
  private reload = 0;
  private reloadAnim = 0; // 0..1 durante a recarga
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
  hidden = false;

  constructor(private camera: THREE.PerspectiveCamera, private scene: THREE.Scene) {}

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
  }

  startReload() {
    this.reloadAnim = 1;
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

  update(dt: number, moving: boolean, reloading: boolean, alive: boolean, speed: number, zoomed: boolean) {
    const nowMs = performance.now();
    this.shells = this.shells.filter((s) => {
      if (nowMs > s.until) { this.scene.remove(s.mesh); return false; }
      s.vel.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin * dt;
      s.mesh.rotation.z += s.spin * 0.7 * dt;
      return true;
    });

    const vm = this.holder;
    if (!vm) return;
    vm.visible = alive && !zoomed && !this.hidden;
    if (this.arms) this.arms.root.visible = vm.visible;
    if (!vm.visible) return;
    this.bob += dt * (moving ? 6 + speed * 0.6 : 2);
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.reload += ((reloading ? 1 : 0) - this.reload) * Math.min(1, dt * 8);
    this.reloadAnim = Math.max(0, this.reloadAnim - dt * 0.9);
    this.raise = Math.max(0, this.raise - dt * 3.5);

    const bobAmp = moving ? 0.018 + speed * 0.001 : 0.004;
    const melee = this.isMelee;
    const baseX = this.weaponId === "claws" ? 0 : this.base.x;
    const baseY = this.weaponId === "claws" ? 0 : this.base.y;
    const baseZ = this.weaponId === "claws" ? 0 : this.base.z;
    const reloadDip = Math.sin(this.reloadAnim * Math.PI) * 0.22 + this.reload * 0.08;
    const raiseDip = this.raise * this.raise * 0.35;
    vm.position.set(
      baseX + Math.sin(this.bob) * bobAmp,
      baseY + Math.abs(Math.cos(this.bob)) * bobAmp * 0.8 - reloadDip - raiseDip,
      baseZ + (melee ? -this.recoil * 0.3 : this.recoil * 0.07),
    );
    const baseRy = melee ? (this.weaponId === "knife" ? (VM_OFFSET.knife.ry) : 0) : (VM_OFFSET[this.weaponId] && getWeaponModel(this.weaponId) ? VM_OFFSET[this.weaponId].ry : 0.06);
    vm.rotation.set(
      (melee ? 0 : 0.03) + this.recoil * (melee ? -0.35 : 0.22) + Math.sin(this.reloadAnim * Math.PI) * 0.7 + raiseDip * 1.5,
      baseRy + Math.sin(this.reloadAnim * Math.PI) * 0.45,
      this.recoil * 0.05 + Math.sin(this.reloadAnim * Math.PI) * 0.3,
    );

    this.poseArms();

    if (this.muzzle && this.muzzle.visible && nowMs > this.muzzleUntil) {
      this.muzzle.visible = false;
      if (this.muzzleGlow) this.muzzleGlow.visible = false;
      if (this.muzzleLight) this.muzzleLight.intensity = 0;
    }
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
    if (grip) arms.reach("L", toCam(v(-0.025, -0.075, 0.03)), dir(v(0, -0.55, -0.8)), dir(v(1, 0, 0)), dir(v(-0.6, -1, 0.25)), 1.0);
    else arms.reach("L", toCam(v(0.0, -0.03, -this.len * 0.28)), dir(v(0, 0.05, -1)), dir(v(0, 1, 0)), dir(v(-0.5, -1, 0.25)), 0.75);
  }
}
