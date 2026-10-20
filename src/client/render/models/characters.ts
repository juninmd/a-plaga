import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { makeWeaponModel } from "./weapons";
import { applyRot, dressZombie, dropBones } from "./zombieParts";

// ===== Personagens: soldado tático realista (rig Mixamo "Vanguard") — humanos e zumbis compartilham o rig =====
// Humanos: pose de arma pelos ossos dos braços sobre os clipes Idle/Walk/Run (pernas seguem a velocidade).
// Zumbis: mesmo corpo com pele apodrecida, postura curvada e braços à frente.

const MODEL_URL = "/models/characters/Soldier.glb";
/** Altura-alvo do personagem em metros (BALANCE.playerHeight). */
const TARGET_HEIGHT = 1.8;

export interface SkinDef {
  /** Cor da farda/pele multiplicada sobre a textura. */
  tint: number;
  /** Cor do visor (humanos) / olhos (zumbis). */
  visor: number;
  /** Aparência apodrecida: pele esverdeada, farda rasgada escura. */
  zombie?: boolean;
  /** Esconde o capacete/visor. */
  noVisor?: boolean;
  emissive?: number;
}

export const SKINS: Record<string, SkinDef> = {
  // Zumbis
  classic: { tint: 0x7fa86a, visor: 0xe8ff40, zombie: true, noVisor: true },
  runner: { tint: 0xb59a4a, visor: 0xffb300, zombie: true, noVisor: true },
  tank: { tint: 0x8a6f5a, visor: 0xff6e40, zombie: true, noVisor: true },
  boomer: { tint: 0xa6c24a, visor: 0xcddc39, zombie: true, noVisor: true },
  smoker: { tint: 0x6e8a86, visor: 0x80cbc4, zombie: true, noVisor: true },
  spitter: { tint: 0x56b07a, visor: 0x69f0ae, zombie: true, noVisor: true },
  witch: { tint: 0x9a78c0, visor: 0xe040fb, zombie: true, noVisor: true },
  nemesis: { tint: 0x9a2a2a, visor: 0xff1744, zombie: true, noVisor: true, emissive: 0x330000 },
  // Humanos (operadores)
  assault: { tint: 0x8fb4ff, visor: 0x4fc3f7 },
  medic: { tint: 0xd8fff0, visor: 0x69f0ae },
  heavy: { tint: 0xff9c8f, visor: 0xff5252 },
  ghost: { tint: 0xb8c4cc, visor: 0xb0bec5 },
  doomslayer: { tint: 0x8a3a3a, visor: 0xffab00, emissive: 0x1a0300 },
  survivor: { tint: 0x7dd3ff, visor: 0x00e5ff, emissive: 0x001a22 },
};

let source: THREE.Group | null = null;
let clips: THREE.AnimationClip[] = [];
let preload: Promise<void> | null = null;
let naturalHeight = 1;

export function preloadCharacterModels(): Promise<void> {
  if (!preload) {
    preload = new GLTFLoader()
      .loadAsync(MODEL_URL)
      .then((g) => {
        source = g.scene;
        clips = g.animations;
        source.updateMatrixWorld(true);
        const box = new THREE.Box3();
        source.traverse((o) => {
          if (o instanceof THREE.SkinnedMesh) {
            o.geometry.computeBoundingBox();
            if (o.geometry.boundingBox) box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
          }
        });
        naturalHeight = box.max.y - box.min.y || 1;
      })
      .catch((err) => console.warn("personagem GLB indisponível, usando procedural", err));
  }
  return preload;
}

/** Clone do soldado já na altura-alvo (para os braços em primeira pessoa). */
export function cloneSoldier(): { scene: THREE.Group; k: number } | null {
  if (!source) return null;
  return { scene: cloneSkinned(source) as THREE.Group, k: TARGET_HEIGHT / naturalHeight };
}

export function charactersReady(): boolean {
  return source != null;
}

// ----- Poses procedurais (deltas locais em relação à T-pose, em radianos XYZ) -----

type Delta = [number, number, number];
export interface PoseDef { [bone: string]: Delta }

/** Pose de fuzil: coronha no ombro direito, mão esquerda no guarda-mão. Ajustável (viewer). */
export const HUMAN_AIM: PoseDef = {
  RightArm: [0, 0.6, 0.95],
  RightForeArm: [0, 0, 1.4],
  LeftArm: [0, -0.6, 0.95],
  LeftForeArm: [0, 0, 1.1],
  Spine1: [0, 0, 0],
  Spine2: [0, 0, 0],
};

/** Zumbi: tronco curvado, braços estendidos à frente, cabeça caída. */
export const ZOMBIE_POSE: PoseDef = {
  RightArm: [1.35, 0, -0.15],
  RightForeArm: [0, 0, 0.2],
  LeftArm: [-1.35, 0, -0.15], // eixos X/Y do rig são espelhados entre os lados; Z não
  LeftForeArm: [0, 0, 0.2],
  Spine: [0.16, 0, 0],
  Spine1: [0.18, 0, 0],
  Spine2: [0.1, 0, 0],
  Head: [0.25, 0, 0],
};

export interface CharacterInput {
  speed: number;
  crouch: number; // 0..1
  airborne: boolean;
  /** Pitch da mira (rad): inclina a arma. */
  pitch?: number;
}

export interface CharacterRig {
  root: THREE.Group;
  materials: THREE.Material[];
  update(dt: number, input: CharacterInput): void;
  melee(): void;
  shoot(): void;
  die(): void;
  revive(): void;
}

interface BoneRef { bone: THREE.Bone; rest: THREE.Quaternion; delta: THREE.Quaternion }

export function makeCharacter(classId: string, team: "human" | "zombie", weaponId: string): CharacterRig | null {
  if (!source) return null;
  const skin = SKINS[classId] ?? (team === "zombie" ? SKINS.classic : SKINS.assault);
  const zombie = team === "zombie";

  const root = new THREE.Group();
  const model = cloneSkinned(source) as THREE.Group;
  const k = TARGET_HEIGHT / naturalHeight;
  model.scale.setScalar(k);
  root.add(model);

  const materials: THREE.Material[] = [];
  model.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    o.frustumCulled = false; // bounding box do skinned mesh não acompanha a animação
    const m = (o.material as THREE.MeshStandardMaterial).clone();
    const visor = /visor/i.test(m.name) || /visor/i.test(o.name);
    if (visor) {
      if (skin.noVisor) {
        o.visible = false;
        return;
      }
      m.color.setHex(skin.visor);
      m.emissive = new THREE.Color(skin.visor).multiplyScalar(0.35);
    } else {
      m.color.setHex(skin.tint);
      if (skin.emissive) m.emissive = new THREE.Color(skin.emissive);
      if (skin.zombie) {
        m.roughness = 1;
        m.metalness = 0;
      }
    }
    if (zombie && !visor) {
      applyRot(m, skin.emissive ? 1 : 0.7, classId.length * 0.137);
      o.geometry = dropBones(o, /Head$|HeadTop/i); // tira o capacete: entra a cabeça de zumbi
    }
    o.material = m;
    materials.push(m);
  });
  if (zombie) {
    root.updateMatrixWorld(true);
    materials.push(...dressZombie(model, classId, skin.tint, skin.visor).materials);
  }

  // Ossos controlados à mão (pose de arma / zumbi) por cima da animação
  const pose = zombie ? ZOMBIE_POSE : HUMAN_AIM;
  const refs: BoneRef[] = [];
  for (const [name, d] of Object.entries(pose)) {
    const bone = model.getObjectByName(`mixamorig${name}`) ?? model.getObjectByName(`mixamorig:${name}`);
    if (bone instanceof THREE.Bone) {
      refs.push({ bone, rest: bone.quaternion.clone(), delta: new THREE.Quaternion().setFromEuler(new THREE.Euler(...d)) });
    }
  }
  const poseFor = (name: string) => refs.find((r) => r.bone.name.endsWith(name));

  // Arma na mão direita
  let handHold: { hand: THREE.Object3D; hold: THREE.Group } | null = null;
  if (!zombie) {
    const hand = model.getObjectByName("mixamorigRightHand") ?? model.getObjectByName("mixamorig:RightHand");
    if (hand) {
      const gun = makeWeaponModel(weaponId);
      gun.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.material = (o.material as THREE.Material).clone();
          materials.push(o.material as THREE.Material);
        }
      });
      const hold = new THREE.Group();
      hold.name = "gun-hold";
      root.updateMatrixWorld(true);
      const ws = new THREE.Vector3();
      hand.getWorldScale(ws);
      hold.scale.setScalar(1 / (ws.x || 1)); // os ossos herdam a escala do rig; a arma já está em metros
      hold.add(gun);
      hand.add(hold);
      handHold = { hand, hold };
    }
  }

  const mixer = new THREE.AnimationMixer(model);
  const named = (n: string) => clips.find((c) => c.name === n);
  const aIdle = named("Idle") ? mixer.clipAction(named("Idle")!) : null;
  const aWalk = named("Walk") ? mixer.clipAction(named("Walk")!) : null;
  const aRun = named("Run") ? mixer.clipAction(named("Run")!) : null;
  for (const a of [aIdle, aWalk, aRun]) a?.play();
  aIdle?.setEffectiveWeight(1);
  aWalk?.setEffectiveWeight(0);
  aRun?.setEffectiveWeight(0);

  let wIdle = 1, wWalk = 0, wRun = 0;
  let dead = false;
  let deadT = 0;
  let meleeT = 0;
  let shootT = 0;
  const tmp = new THREE.Quaternion();
  const qHand = new THREE.Quaternion();
  const qRoot = new THREE.Quaternion();
  const qAim = new THREE.Quaternion();
  const eAim = new THREE.Euler();

  return {
    root,
    materials,
    update(dt, input) {
      if (!dead) {
        const s = input.speed;
        const tIdle = s < 0.4 ? 1 : 0;
        const tRun = THREE.MathUtils.clamp((s - 4.2) / 1.6, 0, 1);
        const tWalk = s < 0.4 ? 0 : 1 - tRun;
        const kk = 1 - Math.exp(-14 * dt);
        wIdle += (tIdle - wIdle) * kk;
        wWalk += (tWalk - wWalk) * kk;
        wRun += (tRun - wRun) * kk;
        aIdle?.setEffectiveWeight(wIdle);
        aWalk?.setEffectiveWeight(wWalk);
        aRun?.setEffectiveWeight(wRun);
        aWalk?.setEffectiveTimeScale(THREE.MathUtils.clamp(s / 1.5, 0.6, 1.5));
        aRun?.setEffectiveTimeScale(THREE.MathUtils.clamp(s / 5.2, 0.8, 1.4));
        model.scale.set(k, k * (1 - input.crouch * 0.3), k);
      }
      mixer.update(dt);

      if (dead) {
        // Tomba para trás: gira o corpo todo sobre o eixo X até deitar
        deadT = Math.min(1, deadT + dt / 0.55);
        const e = 1 - (1 - deadT) * (1 - deadT);
        model.rotation.x = -e * (Math.PI / 2 - 0.08);
        model.position.y = e * 0.18;
        return;
      }
      meleeT = Math.max(0, meleeT - dt * 3.5);
      shootT = Math.max(0, shootT - dt * 8);
      for (const r of refs) {
        // pose = repouso (T-pose da animação) * delta; golpe/disparo somam um tranco
        tmp.copy(r.rest).multiply(r.delta);
        r.bone.quaternion.copy(tmp);
      }
      // O clipe move os ossos todo frame: reaplica a pose depois do mixer
      const arm = poseFor("RightArm");
      if (arm && (meleeT > 0 || shootT > 0)) {
        const kick = Math.sin(meleeT * Math.PI) * -0.9 + shootT * 0.12;
        arm.bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(kick, 0, 0)));
      }
      if (handHold) {
        // A arma aponta sempre para onde o jogador olha, qualquer que seja a pose da mão
        root.updateMatrixWorld(true);
        handHold.hand.getWorldQuaternion(qHand);
        root.getWorldQuaternion(qRoot);
        eAim.set((input.pitch ?? 0) + 0.12 - shootT * 0.05, 0, 0);
        qAim.setFromEuler(eAim);
        handHold.hold.quaternion.copy(qHand).invert().multiply(qRoot).multiply(qAim);
      }
    },
    melee() {
      if (!dead) meleeT = 1;
    },
    shoot() {
      if (!dead) shootT = 1;
    },
    die() {
      dead = true;
      deadT = 0;
    },
    revive() {
      dead = false;
      deadT = 0;
      model.rotation.x = 0;
      model.position.y = 0;
    },
  };
}
