import * as THREE from "three";
import { camoTexture, kevlarTexture, tex } from "../textures";
import { makeWeaponModel } from "./weapons";
import { getWeaponModel } from "./gltf";

/** Peças animáveis de um boneco (humano ou zumbi). */
export interface BuiltModel {
  group: THREE.Group;
  /** Tronco + cabeça + braços; abaixa ao agachar. */
  upper: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  shinL: THREE.Group;
  shinR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  tinted: THREE.MeshStandardMaterial[];
  fadeable: THREE.Material[];
  /** Postura de descanso dos braços (rotation.x). */
  armRest: { l: number; r: number };
}

const skinMat = () => new THREE.MeshStandardMaterial({ color: 0xd1a37c, roughness: 0.7 });

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.position.set(x, y, z);
  return me;
}
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export function makeHumanModel(color: number, classId: string, weaponId: string): BuiltModel {
  const g = new THREE.Group();
  const base = new THREE.Color(color);
  const uniform = new THREE.MeshStandardMaterial({ map: tex("camo", () => camoTexture()), color: base.clone().lerp(new THREE.Color(0xffffff), 0.35), roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.45), roughness: 0.8 });
  const vestMat = new THREE.MeshStandardMaterial({ map: tex("kevlar", kevlarTexture), color: 0x9a9a9a, roughness: 0.75 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.8 });
  const skin = skinMat();
  const accent = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x1f3f5f, roughness: 0.15, metalness: 0.6, emissive: 0x081a2a });
  const tinted = [uniform, dark];
  const fadeable: THREE.Material[] = [uniform, dark, vestMat, black, skin, accent, red, glassMat];

  const bulk = classId === "heavy" || classId === "survivor" ? 1.25 : classId === "ghost" ? 0.88 : 1;

  // --- Pernas segmentadas (coxa -> canela -> bota), pivô no quadril ---
  const mkLeg = (x: number) => {
    const leg = new THREE.Group();
    leg.position.set(x, 0.78, 0);
    leg.add(mesh(B(0.17, 0.4, 0.19), uniform, 0, -0.2, 0));
    const shin = new THREE.Group();
    shin.position.y = -0.4;
    shin.add(mesh(B(0.15, 0.36, 0.17), uniform, 0, -0.18, 0));
    shin.add(mesh(B(0.16, 0.12, 0.1), black, 0, -0.06, -0.08)); // joelheira
    shin.add(mesh(B(0.17, 0.1, 0.3), black, 0, -0.35, -0.05)); // bota
    leg.add(shin);
    return { leg, shin };
  };
  const L = mkLeg(-0.14);
  const R = mkLeg(0.14);

  // --- Parte de cima (abaixa ao agachar) ---
  const upper = new THREE.Group();
  upper.add(mesh(B(0.48 * bulk, 0.56, 0.26 * bulk), uniform, 0, 1.06, 0)); // tronco
  upper.add(mesh(B(0.52 * bulk, 0.42, 0.34 * bulk), vestMat, 0, 1.1, 0)); // colete
  upper.add(mesh(B(0.34 * bulk, 0.1, 0.06), black, 0, 0.9, -0.19 * bulk)); // cinto
  // Bolsos do colete
  for (const x of [-0.13, 0, 0.13]) upper.add(mesh(B(0.1, 0.12, 0.06), black, x * bulk, 1.02, -0.2 * bulk));
  upper.add(mesh(B(0.2, 0.1, 0.05), black, 0, 1.22, -0.2 * bulk)); // rádio no peito
  upper.add(mesh(B(0.4 * bulk, 0.08, 0.1), black, 0, 0.86, 0.1)); // cinto traseiro

  // --- Braços (ombro -> antebraço -> luva) ---
  const mkArm = (x: number) => {
    const arm = new THREE.Group();
    arm.position.set(x, 1.28, 0);
    arm.add(mesh(B(0.14 * bulk, 0.3, 0.15 * bulk), uniform, 0, -0.15, 0));
    arm.add(mesh(B(0.16 * bulk, 0.1, 0.17 * bulk), vestMat, 0, -0.02, 0)); // ombreira
    const fore = mesh(B(0.12 * bulk, 0.28, 0.13 * bulk), uniform, 0, -0.42, 0);
    arm.add(fore);
    arm.add(mesh(B(0.1, 0.1, 0.1), black, 0, -0.58, 0)); // luva
    return arm;
  };
  const armL = mkArm(-0.32 * bulk);
  const armR = mkArm(0.32 * bulk);
  const armRest = { l: -1.15, r: -1.35 };
  armR.rotation.x = armRest.r;
  armL.rotation.x = armRest.l;
  armL.rotation.y = 0.45; // mão de apoio no handguard
  upper.add(armL, armR);

  // Arma na mão direita, apontando para -z quando o braço está levantado
  const gun = makeWeaponModel(weaponId);
  // GLB tem escala real e origem na empunhadura; o procedural é centrado no receiver
  const real = getWeaponModel(weaponId) != null;
  gun.scale.setScalar(real ? 0.9 : 0.72);
  // O braço aponta para -y local; gira a arma para o cano seguir o braço, com a mira para cima
  gun.rotation.set(-Math.PI / 2, 0, Math.PI);
  gun.position.set(0, real ? -0.5 : -0.58, real ? 0.0 : -0.02);
  gun.traverse((o) => {
    if (o instanceof THREE.Mesh) fadeable.push(o.material as THREE.Material);
  });
  armR.add(gun);

  // --- Cabeça: balaclava + capacete + óculos ---
  const head = new THREE.Group();
  head.position.y = 1.6;
  head.add(mesh(B(0.26, 0.28, 0.26), black, 0, 0, 0)); // balaclava
  head.add(mesh(B(0.2, 0.08, 0.02), skin, 0, 0.03, -0.135)); // faixa dos olhos
  const helmet = mesh(B(0.3, 0.14, 0.3), dark, 0, 0.14, 0); // capacete
  head.add(helmet);
  head.add(mesh(B(0.32, 0.05, 0.32), dark, 0, 0.08, 0)); // aba do capacete
  head.add(mesh(B(0.24, 0.07, 0.03), black, 0, 0.19, -0.14)); // óculos no capacete
  head.add(mesh(B(0.2, 0.05, 0.01), glassMat, 0, 0.19, -0.155));
  head.add(mesh(B(0.03, 0.06, 0.06), black, -0.145, 0, -0.02)); // fone
  head.add(mesh(B(0.02, 0.02, 0.1), black, -0.14, -0.04, -0.08)); // microfone
  upper.add(head);

  // --- Adereços de classe ---
  switch (classId) {
    case "medic":
      helmet.material = accent; // capacete branco
      upper.add(mesh(B(0.18, 0.05, 0.02), red, 0, 1.12, -0.21 * bulk));
      upper.add(mesh(B(0.05, 0.18, 0.02), red, 0, 1.12, -0.21 * bulk));
      upper.add(mesh(B(0.28, 0.3, 0.16), accent, 0, 1.06, 0.22)); // mochila médica
      upper.add(mesh(B(0.12, 0.04, 0.02), red, 0, 1.06, 0.31));
      break;
    case "heavy":
      head.add(mesh(B(0.36, 0.2, 0.36), dark, 0, 0.14, 0));
      head.add(mesh(B(0.3, 0.1, 0.03), glassMat, 0, 0.02, -0.17)); // viseira balística
      upper.add(mesh(B(0.2, 0.16, 0.26), dark, -0.42 * bulk, 1.32, 0));
      upper.add(mesh(B(0.2, 0.16, 0.26), dark, 0.42 * bulk, 1.32, 0));
      upper.add(mesh(B(0.56 * bulk, 0.5, 0.06), vestMat, 0, 1.06, -0.2 * bulk)); // placa frontal
      break;
    case "ghost": {
      const hood = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.36, 6), dark);
      hood.position.set(0, 0.16, 0.02);
      head.add(hood);
      upper.add(mesh(B(0.32, 0.6, 0.05), dark, 0, 0.98, 0.17)); // capa
      break;
    }
    case "doomslayer": {
      helmet.material = red;
      head.add(mesh(B(0.26, 0.06, 0.03), red, 0, 0.03, -0.15)); // visor vermelho
      const horn = () => new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 5), accent);
      const hl = horn(); hl.position.set(-0.17, 0.26, 0); hl.rotation.z = 0.6;
      const hr = horn(); hr.position.set(0.17, 0.26, 0); hr.rotation.z = -0.6;
      head.add(hl, hr);
      break;
    }
    case "survivor": {
      helmet.material = accent;
      upper.add(mesh(B(0.28, 0.32, 0.18), dark, 0, 1.08, 0.24)); // mochila de munição
      const belt = mesh(B(0.56 * bulk, 0.07, 0.36 * bulk), accent, 0, 1.0, 0);
      belt.rotation.z = 0.35;
      upper.add(belt);
      for (let i = 0; i < 6; i++) upper.add(mesh(B(0.03, 0.09, 0.03), new THREE.MeshStandardMaterial({ color: 0xc9a04a, metalness: 0.7, roughness: 0.4 }), -0.2 + i * 0.08, 0.98 + i * 0.03, -0.19 * bulk));
      break;
    }
  }

  g.add(L.leg, R.leg, upper);
  return { group: g, upper, legL: L.leg, legR: R.leg, shinL: L.shin, shinR: R.shin, armL, armR, tinted, fadeable, armRest };
}
