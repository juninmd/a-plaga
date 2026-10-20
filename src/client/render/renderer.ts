import * as THREE from "three";
import type { PickupState, PlayerState, ProjectileState, Team } from "../../shared/protocol";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Effects } from "./effects";
import { PlayerRegistry } from "./players";
import { IS_MOBILE } from "./textures";
import { Viewmodel } from "./viewmodel";
import { buildWorld, type World } from "./world";

export { IS_MOBILE };

const DEFAULT_FOV = 75;
const VM_FOV = 62;

export interface FrameState {
  moving: boolean;
  reloading: boolean;
  alive: boolean;
  crouching: boolean;
  speed: number;
  lookDYaw: number;
  lookDPitch: number;
  strafe: number;
  forward: number;
  airborne: boolean;
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
  /** Passe próprio do viewmodel: FOV fixo e depth limpo — a arma nunca entra na parede. */
  private vmScene = new THREE.Scene();
  private vmCamera: THREE.PerspectiveCamera;
  /** Pós-processamento (AO + bloom) só no desktop; `?fx=0` desliga. */
  private composer: EffectComposer | null = null;
  /** Lanterna presa à câmera (luz fixa no shader: só muda a intensidade). */
  private flashlight: THREE.SpotLight;
  private flashlightOn = false;
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
    // Pixel ratio alto é o maior custo de fill-rate em telas 4K/retina — 1.5 já fica nítido
    this.renderer.setPixelRatio(Math.min(IS_MOBILE ? 1.25 : 1.5, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = !IS_MOBILE;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    document.getElementById("app")!.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, window.innerWidth / window.innerHeight, 0.05, 400);
    this.camera.rotation.order = "YXZ";
    // A câmera entra na cena para que o viewmodel (filho dela) seja renderizado
    this.scene.add(this.camera);
    this.flashlight = new THREE.SpotLight(0xe6edff, 0, 42, 0.46, 0.6, 1.35);
    this.flashlight.position.set(0.14, -0.12, 0);
    this.flashlight.target.position.set(0.02, -0.05, -6);
    this.camera.add(this.flashlight, this.flashlight.target);
    this.vmCamera = new THREE.PerspectiveCamera(VM_FOV, window.innerWidth / window.innerHeight, 0.02, 10);
    this.vmScene.add(this.vmCamera);
    // Luz própria do viewmodel (luzes não cruzam cenas): sol quente + céu + bounce do chão
    this.vmScene.add(new THREE.HemisphereLight(0xfff0d0, 0x7a6340, 1.6));
    const vmSun = new THREE.DirectionalLight(0xffe2bb, 2.2);
    vmSun.position.set(0.6, 1, 0.5);
    this.vmScene.add(vmSun);
    const vmLight = new THREE.PointLight(0xffe2bb, 1.4, 3.5);
    vmLight.position.set(0.3, 0.2, 0.1);
    this.vmCamera.add(vmLight);
    this.renderer.autoClear = false;

    this.world = buildWorld(this.scene, this.renderer);
    this.playersReg = new PlayerRegistry(this.scene, this.clock);
    this.vm = new Viewmodel(this.camera, this.scene, this.vmCamera);
    this.setupPost();
    this.fx = new Effects(this.scene);

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.vmCamera.aspect = this.camera.aspect;
      this.vmCamera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.composer?.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private setupPost() {
    const off = new URLSearchParams(location.search).get("fx") === "0";
    if (IS_MOBILE || off) return;
    try {
      const w = window.innerWidth, h = window.innerHeight;
      const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
      const composer = new EffectComposer(this.renderer, target);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const ao = new GTAOPass(this.scene, this.camera, w, h);
      ao.output = GTAOPass.OUTPUT.Default;
      ao.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
      composer.addPass(ao);
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.55, 1.0));
      composer.addPass(new OutputPass());
      this.composer = composer;
    } catch (err) {
      console.warn("pós-processamento indisponível", err);
      this.composer = null;
    }
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
  playerShot(id: number) {
    this.playersReg.shot(id);
  }
  corpseImpulse(id: number, dirX: number, dirZ: number, strength: number) {
    this.playersReg.corpseImpulse(id, dirX, dirZ, strength);
  }
  setPlayerPose(id: number, x: number, y: number, z: number, yaw: number, pitch: number) {
    this.playersReg.setPose(id, x, y, z, yaw, pitch);
  }
  /** Loop de render sincronizado ao vsync do navegador. */
  setAnimationLoop(cb: () => void) {
    this.renderer.setAnimationLoop(cb);
  }

  // ===== Viewmodel =====

  setViewmodel(weaponId: string, team: Team, classId = "") {
    this.vm.set(weaponId, team, classId);
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
  setFlashlight(on: boolean) {
    this.flashlightOn = on;
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
  /** Ejeta um cartucho: da câmera (arma local) ou de `from` na direção do tiro (outros jogadores). */
  casing(from: THREE.Vector3, dir: THREE.Vector3, local: boolean) {
    const up = new THREE.Vector3(0, 1, 0);
    if (local) {
      this.camera.updateMatrixWorld();
      const m = this.camera.matrixWorld;
      const right = new THREE.Vector3().setFromMatrixColumn(m, 0).normalize();
      const camUp = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();
      const fwd = new THREE.Vector3().setFromMatrixColumn(m, 2).normalize().negate();
      const pos = this.camera.position.clone().addScaledVector(right, 0.2).addScaledVector(camUp, -0.13).addScaledVector(fwd, 0.45);
      this.fx.casing(pos, right, camUp, 1);
    } else {
      const right = new THREE.Vector3().crossVectors(dir, up).normalize();
      this.fx.casing(from.clone().addScaledVector(right, 0.1), right, up, 1.3);
    }
  }
  onCasingBounce(cb: (pos: THREE.Vector3, impact: number) => void) {
    this.fx.onCasingBounce = cb;
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
    const li = this.flashlight.intensity;
    this.flashlight.intensity = li + ((this.flashlightOn ? 55 : 0) - li) * Math.min(1, dt * 18);
    this.playersReg.update(dt);
    this.vm.update(dt, {
      moving: state.moving,
      reloading: state.reloading,
      alive: state.alive,
      speed: state.speed,
      zoomed: this.zoomed,
      lookDYaw: state.lookDYaw,
      lookDPitch: state.lookDPitch,
      strafe: state.strafe,
      forward: state.forward,
      airborne: state.airborne,
    });
    this.world.update(dt, this.camPos);

    // Câmera: posição + punch/shake
    const [dp, dy, roll] = this.fx.cameraOffset(dt);
    this.camera.position.copy(this.camPos);
    this.camera.rotation.set(this.camPitch + dp, this.camYaw + dy, roll);
    if (Math.abs(this.camera.fov - this.targetFov) > 0.05) {
      this.camera.fov += (this.targetFov - this.camera.fov) * Math.min(1, dt * 14);
      this.camera.updateProjectionMatrix();
    }
    if (this.composer) {
      this.composer.render(dt);
    } else {
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
    }
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }
}

export function createRenderer(): Renderer {
  return new Renderer();
}
