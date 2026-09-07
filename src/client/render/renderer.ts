import * as THREE from "three";
import type { PickupState, PlayerState, ProjectileState, Team } from "../../shared/protocol";
import { Effects } from "./effects";
import { PlayerRegistry } from "./players";
import { IS_MOBILE } from "./textures";
import { Viewmodel } from "./viewmodel";
import { buildWorld, type World } from "./world";

export { IS_MOBILE };

const DEFAULT_FOV = 75;

export interface FrameState {
  moving: boolean;
  reloading: boolean;
  alive: boolean;
  crouching: boolean;
  speed: number;
}

// ===== Composição: mundo + jogadores + viewmodel + efeitos =====

export class Renderer {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  clock = new THREE.Clock();
  private world: World;
  private playersReg: PlayerRegistry;
  private vm: Viewmodel;
  private fx: Effects;
  private pickups = new Map<number, THREE.Mesh>();
  private projectiles = new Map<number, THREE.Group>();
  private targetFov = DEFAULT_FOV;
  private zoomed = false;
  private camPos = new THREE.Vector3();
  private camYaw = 0;
  private camPitch = 0;

  get localId(): number {
    return this.playersReg.localId;
  }
  set localId(id: number) {
    this.playersReg.localId = id;
  }

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: !IS_MOBILE, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(IS_MOBILE ? 1.5 : 2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = !IS_MOBILE;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    document.getElementById("app")!.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, window.innerWidth / window.innerHeight, 0.05, 400);
    this.camera.rotation.order = "YXZ";
    // A câmera entra na cena para que o viewmodel (filho dela) seja renderizado
    this.scene.add(this.camera);
    const vmLight = new THREE.PointLight(0xffe2bb, 2.0, 3.5);
    vmLight.position.set(0.3, 0.2, 0.1);
    this.camera.add(vmLight);

    this.world = buildWorld(this.scene);
    this.playersReg = new PlayerRegistry(this.scene, this.clock);
    this.vm = new Viewmodel(this.camera, this.scene);
    this.fx = new Effects(this.scene);

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // ===== Jogadores =====

  upsertPlayer(p: PlayerState) {
    this.playersReg.upsert(p);
  }
  removePlayer(id: number) {
    this.playersReg.remove(id);
  }
  playerIds(): number[] {
    return this.playersReg.ids();
  }
  meleeSwing(id: number) {
    this.playersReg.meleeSwing(id);
  }

  // ===== Viewmodel =====

  setViewmodel(weaponId: string, team: Team) {
    this.vm.set(weaponId, team);
  }
  viewmodelFire() {
    this.vm.fire();
  }
  viewmodelReload() {
    this.vm.startReload();
  }
  viewmodelSwitch() {
    this.vm.switchAnim();
  }

  // ===== Câmera =====

  setLocalCamera(pos: THREE.Vector3, yaw: number, pitch: number) {
    this.camPos.copy(pos);
    this.camYaw = yaw;
    this.camPitch = pitch;
  }
  punch(pitch: number, yaw: number) {
    this.fx.punch(pitch, yaw);
  }
  shake(intensity: number) {
    this.fx.shake(intensity);
  }
  setZoom(fov: number | null) {
    this.targetFov = fov ?? DEFAULT_FOV;
    this.zoomed = fov != null;
  }

  // ===== Efeitos =====

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    this.fx.tracer(from, to, color);
  }
  impact(pos: THREE.Vector3, normal: THREE.Vector3) {
    this.fx.impact(pos, normal);
  }
  blood(pos: THREE.Vector3, amount: number) {
    this.fx.blood(pos, amount);
  }
  explosion(pos: THREE.Vector3, color: number, radius: number) {
    this.fx.explosion(pos, color, radius);
  }

  damageNumber(pos: THREE.Vector3, value: number, headshot: boolean) {
    const center = document.getElementById("damage-numbers");
    if (!center) return;
    const v = pos.clone().project(this.camera);
    if (v.z > 1) return; // atrás da câmera
    const el = document.createElement("div");
    el.className = "dmg" + (headshot ? " headshot" : " hit");
    el.textContent = String(Math.round(value));
    el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    el.style.setProperty("--dx", `${(Math.random() - 0.5) * 60}px`);
    center.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  // ===== Pickups =====

  upsertPickups(pickups: PickupState[]) {
    const seen = new Set<number>();
    for (const pk of pickups) {
      seen.add(pk.id);
      let mesh = this.pickups.get(pk.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.25),
          new THREE.MeshStandardMaterial({ color: 0x00e676, emissive: 0x00a050, roughness: 0.3, metalness: 0.5 }),
        );
        this.scene.add(mesh);
        this.pickups.set(pk.id, mesh);
      }
      mesh.position.set(pk.pos.x, pk.pos.y + Math.sin(this.clock.elapsedTime * 3) * 0.1, pk.pos.z);
      mesh.rotation.y += 0.05;
    }
    for (const [id, mesh] of this.pickups) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.pickups.delete(id);
      }
    }
  }

  // ===== Projéteis =====

  upsertProjectiles(projs: ProjectileState[]) {
    const seen = new Set<number>();
    for (const pr of projs) {
      seen.add(pr.id);
      let g = this.projectiles.get(pr.id);
      if (!g) {
        g = new THREE.Group();
        const color = pr.kind === "fire_grenade" ? 0xff6d00 : pr.kind === "frost_grenade" ? 0x4fc3f7 : pr.kind === "pipebomb" ? 0x444444 : 0x9ccc65;
        const body = new THREE.Mesh(
          pr.kind === "acid" ? new THREE.SphereGeometry(0.14, 8, 6) : new THREE.CylinderGeometry(0.09, 0.09, 0.2, 8),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: pr.kind === "acid" ? 0.8 : 0.25, roughness: 0.5 }),
        );
        g.add(body);
        if (pr.kind !== "acid") {
          const light = new THREE.PointLight(color, IS_MOBILE ? 0 : 1.5, 4);
          g.add(light);
        }
        this.scene.add(g);
        this.projectiles.set(pr.id, g);
      }
      g.position.set(pr.pos.x, pr.pos.y, pr.pos.z);
      g.rotation.x += 0.2;
      g.rotation.z += 0.1;
    }
    for (const [id, g] of this.projectiles) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.projectiles.delete(id);
      }
    }
  }

  // ===== Frame =====

  frame(state: FrameState) {
    const dt = Math.min(0.1, this.clock.getDelta());
    this.fx.update(dt);
    this.playersReg.update(dt);
    this.vm.update(dt, state.moving, state.reloading, state.alive, state.speed, this.zoomed);
    this.world.update(dt, this.camPos);

    // Câmera: posição + punch/shake
    const [dp, dy, roll] = this.fx.cameraOffset(dt);
    this.camera.position.copy(this.camPos);
    this.camera.rotation.set(this.camPitch + dp, this.camYaw + dy, roll);
    if (Math.abs(this.camera.fov - this.targetFov) > 0.05) {
      this.camera.fov += (this.targetFov - this.camera.fov) * Math.min(1, dt * 14);
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }
}

export function createRenderer(): Renderer {
  return new Renderer();
}
