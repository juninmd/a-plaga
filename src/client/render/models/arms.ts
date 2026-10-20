import * as THREE from "three";
import { cloneSoldier, SKINS } from "./characters";
import { applyRot } from "./zombieParts";

// ===== Braços em primeira pessoa: só os braços/mãos do soldado (malha filtrada), posicionados por IK de 2 ossos =====

const ARM_BONE = /^mixamorig:?(Left|Right)(Shoulder|Arm|ForeArm|Hand)/;
const FINGERS = ["Index", "Middle", "Ring", "Pinky"];

type Side = "L" | "R";
const SIDE_NAME: Record<Side, string> = { L: "Left", R: "Right" };

interface Limb {
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  middle: THREE.Object3D | null;
  fingers: { bone: THREE.Bone; rest: THREE.Quaternion }[][];
  thumb: { bone: THREE.Bone; rest: THREE.Quaternion }[];
  restUpper: THREE.Quaternion;
  restFore: THREE.Quaternion;
  restHand: THREE.Quaternion;
  /** Direção dos dedos e da palma em repouso (espaço da raiz). */
  f0: THREE.Vector3;
  p0: THREE.Vector3;
  l1: number;
  l2: number;
}

export interface ArmsRig {
  root: THREE.Group;
  materials: THREE.Material[];
  /** Posiciona o braço: alvo da mão, direção dos dedos, normal da palma e o "cotovelo para onde" (tudo no espaço da câmera). */
  reach(side: Side, target: THREE.Vector3, fingers: THREE.Vector3, palm: THREE.Vector3, pole: THREE.Vector3, curl: number): void;
  hide(side: Side, hidden: boolean): void;
  hand(side: Side): THREE.Object3D;
  /** Fator de escala dos braços em relação ao tamanho real do personagem. */
  readonly scale: number;
}

/** Mantém só os triângulos cujos vértices pertencem a ossos de braço/mão. */
function filterArmGeometry(mesh: THREE.SkinnedMesh): THREE.BufferGeometry {
  const geo = mesh.geometry.clone();
  const skinIndex = geo.getAttribute("skinIndex");
  const skinWeight = geo.getAttribute("skinWeight");
  const bones = mesh.skeleton.bones;
  const count = geo.getAttribute("position").count;
  const isArm = new Uint8Array(count);
  for (let v = 0; v < count; v++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(v, k);
      if (w > bw) { bw = w; best = skinIndex.getComponent(v, k); }
    }
    isArm[v] = ARM_BONE.test(bones[best]?.name ?? "") ? 1 : 0;
  }
  const src = geo.index;
  const out: number[] = [];
  const tri = src ? src.count / 3 : count / 3;
  for (let t = 0; t < tri; t++) {
    const a = src ? src.getX(t * 3) : t * 3;
    const b = src ? src.getX(t * 3 + 1) : t * 3 + 1;
    const c = src ? src.getX(t * 3 + 2) : t * 3 + 2;
    if (isArm[a] && isArm[b] && isArm[c]) out.push(a, b, c);
  }
  geo.setIndex(out);
  return geo;
}

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function makeArmsRig(classId: string, zombie: boolean, armScale: number): ArmsRig | null {
  const c = cloneSoldier();
  if (!c) return null;
  const skin = SKINS[classId] ?? (zombie ? SKINS.classic : SKINS.assault);
  const root = new THREE.Group();
  const model = c.scene;
  model.scale.setScalar(c.k * armScale);
  root.add(model);

  const materials: THREE.Material[] = [];
  model.traverse((o) => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    o.frustumCulled = false;
    if (/visor/i.test(o.name) || /visor/i.test((o.material as THREE.Material).name)) {
      o.visible = false;
      return;
    }
    o.geometry = filterArmGeometry(o);
    const m = (o.material as THREE.MeshStandardMaterial).clone();
    m.color.setHex(skin.tint);
    if (skin.emissive) m.emissive = new THREE.Color(skin.emissive);
    if (zombie) {
      m.roughness = 1;
      m.metalness = 0;
      applyRot(m, 0.8, 1.1);
    }
    o.material = m;
    o.renderOrder = 10;
    materials.push(m);
  });
  root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();

  const find = (n: string) => model.getObjectByName(`mixamorig${n}`) ?? model.getObjectByName(`mixamorig:${n}`) ?? null;
  const rootPos = (o: THREE.Object3D, out: THREE.Vector3) => {
    _m.multiplyMatrices(rootInv, o.matrixWorld);
    return out.setFromMatrixPosition(_m);
  };
  const rootQuat = (o: THREE.Object3D, out: THREE.Quaternion) => {
    _m.multiplyMatrices(rootInv, o.matrixWorld);
    _m.decompose(_p, out, _s);
    return out;
  };

  const limbs = {} as Record<Side, Limb>;
  for (const side of ["L", "R"] as Side[]) {
    const n = SIDE_NAME[side];
    const upper = find(`${n}Arm`) as THREE.Bone, fore = find(`${n}ForeArm`) as THREE.Bone, hand = find(`${n}Hand`) as THREE.Bone;
    const middle = find(`${n}HandMiddle1`);
    const S = rootPos(upper, new THREE.Vector3()), E = rootPos(fore, new THREE.Vector3()), W = rootPos(hand, new THREE.Vector3());
    const f0 = middle ? rootPos(middle, new THREE.Vector3()).sub(W).normalize() : E.clone().sub(W).normalize().negate();
    const chain = (names: string[]) => names.map((nm) => find(nm) as THREE.Bone | null).filter((b): b is THREE.Bone => !!b).map((bone) => ({ bone, rest: bone.quaternion.clone() }));
    limbs[side] = {
      upper, fore, hand, middle,
      fingers: FINGERS.map((f) => chain([1, 2, 3].map((i) => `${n}Hand${f}${i}`))),
      thumb: chain([1, 2, 3].map((i) => `${n}HandThumb${i}`)),
      restUpper: upper.quaternion.clone(),
      restFore: fore.quaternion.clone(),
      restHand: hand.quaternion.clone(),
      f0,
      p0: new THREE.Vector3(0, -1, 0), // T-pose: palma para baixo
      l1: S.distanceTo(E),
      l2: E.distanceTo(W),
    };
  }

  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qC = new THREE.Quaternion();
  const vS = new THREE.Vector3(), vE = new THREE.Vector3(), vW = new THREE.Vector3(), vA = new THREE.Vector3(), vP = new THREE.Vector3(), vE2 = new THREE.Vector3(), vD = new THREE.Vector3();
  const basis = (f: THREE.Vector3, p: THREE.Vector3, out: THREE.Matrix4) => {
    const x = new THREE.Vector3().crossVectors(f, p).normalize();
    const pp = new THREE.Vector3().crossVectors(x, f).normalize();
    return out.makeBasis(f, pp, x);
  };
  const mA = new THREE.Matrix4(), mB = new THREE.Matrix4();

  /** Gira `bone` (espaço da raiz) para que a direção cur → want. */
  const aim = (bone: THREE.Object3D, cur: THREE.Vector3, want: THREE.Vector3) => {
    qA.setFromUnitVectors(cur, want);
    rootQuat(bone, qB);
    qB.premultiply(qA);
    rootQuat(bone.parent!, qC).invert();
    bone.quaternion.copy(qC.multiply(qB));
    bone.updateMatrixWorld(true);
  };

  return {
    root,
    materials,
    scale: armScale,
    hand: (side) => limbs[side].hand,
    hide(side, hidden) {
      limbs[side].upper.visible = !hidden;
      limbs[side].upper.scale.setScalar(hidden ? 0.0001 : 1);
    },
    reach(side, target, fingers, palm, pole, curl) {
      const L = limbs[side];
      L.upper.quaternion.copy(L.restUpper);
      L.fore.quaternion.copy(L.restFore);
      L.hand.quaternion.copy(L.restHand);
      root.updateMatrixWorld(true);
      rootInv.copy(root.matrixWorld).invert();
      rootPos(L.upper, vS);
      vA.copy(target).sub(root.position).sub(vS); // alvo vem no espaço da câmera; a raiz está deslocada nela
      // Alvo além do alcance: estica o braço (escala nos ossos) em vez de deixar a mão para trás
      const need = vA.length() / ((L.l1 + L.l2) * 0.985);
      const stretch = Math.min(1.7, Math.max(1, need));
      L.upper.scale.set(1, stretch, 1);
      L.fore.scale.set(1, 1, 1);
      L.hand.scale.set(1, 1 / stretch, 1); // a mão herda o esticão do antebraço: desfaz
      root.updateMatrixWorld(true);
      const reachMax = (L.l1 + L.l2) * stretch * 0.998;
      const d = Math.min(Math.max(vA.length(), 0.05), reachMax);
      vA.normalize();
      const l1 = L.l1 * stretch, l2 = L.l2 * stretch;
      const x = (d * d + l1 * l1 - l2 * l2) / (2 * d);
      const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
      vP.copy(pole).addScaledVector(vA, -pole.dot(vA)).normalize();
      vE2.copy(vS).addScaledVector(vA, x).addScaledVector(vP, h);
      // Braço
      rootPos(L.fore, vE);
      aim(L.upper, vD.copy(vE).sub(vS).normalize(), vW.copy(vE2).sub(vS).normalize());
      // Antebraço
      rootPos(L.fore, vE);
      rootPos(L.hand, vW);
      const wrist = vS.copy(vS).addScaledVector(vA, d);
      aim(L.fore, vD.copy(vW).sub(vE).normalize(), wrist.clone().sub(vE).normalize());
      // Mão: leva (dedos, palma) de repouso para (dedos, palma) desejados
      root.updateMatrixWorld(true);
      rootInv.copy(root.matrixWorld).invert();
      rootQuat(L.hand, qB);
      basis(L.f0, L.p0, mA);
      basis(fingers.clone().normalize(), palm.clone().normalize(), mB);
      qC.setFromRotationMatrix(mB.multiply(mA.transpose()));
      qB.premultiply(qC);
      const pq = rootQuat(L.hand.parent!, qA).invert();
      L.hand.quaternion.copy(pq.multiply(qB));
      L.hand.updateMatrixWorld(true);
      // Dedos curvados em volta da empunhadura
      const sign = side === "R" ? 1 : -1;
      for (const chain of L.fingers) {
        chain.forEach((fb, i) => fb.bone.quaternion.copy(fb.rest).multiply(qA.setFromAxisAngle(_Z, sign * curl * (i === 0 ? 0.9 : 1.1))));
      }
      L.thumb.forEach((fb, i) => fb.bone.quaternion.copy(fb.rest).multiply(qA.setFromAxisAngle(_Z, sign * curl * 0.35 * (i + 1) * 0.6)));
    },
  };
}

const _Z = new THREE.Vector3(0, 0, 1);
