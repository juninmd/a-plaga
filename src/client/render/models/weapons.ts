import * as THREE from "three";
import { cloneWeapon, getWeaponModel } from "./gltf";

// ===== Modelos low-poly de armas (usados no viewmodel e nas mãos dos outros jogadores) =====
// Convenção: o cano aponta para -z, a empunhadura fica em y negativo.

const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.45, metalness: 0.7 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.6, metalness: 0.4 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.75 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x4b5e3a, roughness: 0.8 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.85 }),
  bone: new THREE.MeshStandardMaterial({ color: 0xd8d4c0, roughness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x2a6fa8, roughness: 0.1, metalness: 0.6, emissive: 0x0a2a44 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 }),
};

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, rz = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.z = rz;
  return mesh;
}
function tube(r: number, len: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 8): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}
/** Carregador curvo (AK/MP5): caixa inclinada para frente. */
function curvedMag(m: THREE.Material, x: number, y: number, z: number, h: number): THREE.Mesh {
  const mesh = box(0.05, h, 0.09, m, x, y, z);
  mesh.rotation.x = 0.35;
  return mesh;
}

/** Posição do bocal (para o clarão) e se ejeta cápsula. */
export const WEAPON_META: Record<string, { muzzleZ: number; muzzleY: number; shells: boolean }> = {
  ak47: { muzzleZ: -0.72, muzzleY: 0.03, shells: true },
  m4a1: { muzzleZ: -0.82, muzzleY: 0.03, shells: true },
  awp: { muzzleZ: -1.05, muzzleY: 0.04, shells: false },
  mp5: { muzzleZ: -0.5, muzzleY: 0.03, shells: true },
  xm1014: { muzzleZ: -0.78, muzzleY: 0.04, shells: true },
  m3: { muzzleZ: -0.75, muzzleY: 0.05, shells: true },
  m249: { muzzleZ: -0.85, muzzleY: 0.04, shells: true },
  deagle: { muzzleZ: -0.36, muzzleY: 0.04, shells: true },
  usp: { muzzleZ: -0.44, muzzleY: 0.04, shells: true },
  glock: { muzzleZ: -0.3, muzzleY: 0.04, shells: true },
  knife: { muzzleZ: 0, muzzleY: 0, shells: false },
  claws: { muzzleZ: 0, muzzleY: 0, shells: false },
};

export interface WeaponMeta {
  muzzleZ: number;
  muzzleY: number;
  shells: boolean;
  /** Comprimento do modelo (m), para posicionar mãos/offsets. */
  length: number;
}

/** Metadados da arma em uso: derivados do GLB quando carregado, senão da tabela procedural. */
export function weaponMeta(weaponId: string): WeaponMeta {
  const base = WEAPON_META[weaponId] ?? WEAPON_META.knife;
  const loaded = getWeaponModel(weaponId);
  if (!loaded) return { ...base, length: Math.abs(base.muzzleZ) + 0.4 };
  return { muzzleZ: loaded.muzzle.z, muzzleY: loaded.muzzle.y, shells: base.shells, length: loaded.box.max.z - loaded.box.min.z };
}

/** Modelo da arma: GLB (Quaternius) quando já carregado, senão o procedural. */
export function makeWeaponModel(weaponId: string): THREE.Group {
  const glb = cloneWeapon(weaponId);
  if (glb) {
    // Materiais próprios por instância: o fade do Fantasma não pode apagar a arma de todo mundo
    glb.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = (o.material as THREE.Material).clone();
    });
    return glb;
  }
  return makeProceduralWeaponModel(weaponId);
}

export function makeProceduralWeaponModel(weaponId: string): THREE.Group {
  const g = new THREE.Group();
  switch (weaponId) {
    case "ak47":
      g.add(
        box(0.07, 0.11, 0.5, M.metal, 0, 0.01, -0.02), // receiver
        box(0.075, 0.09, 0.22, M.wood, 0, 0.0, -0.36), // handguard de madeira
        tube(0.014, 0.4, M.dark, 0, 0.035, -0.55),
        tube(0.011, 0.34, M.dark, 0, 0.075, -0.4), // tubo de gás
        box(0.03, 0.09, 0.05, M.metal, 0, 0.12, -0.5), // alça de mira frontal
        curvedMag(M.metal, 0, -0.14, -0.06, 0.24),
        box(0.05, 0.13, 0.08, M.wood, 0, -0.1, 0.16), // punho
        box(0.06, 0.1, 0.3, M.wood, 0, -0.01, 0.4), // coronha
        box(0.03, 0.05, 0.1, M.dark, 0, 0.09, -0.02), // mira traseira
      );
      break;
    case "m4a1":
      g.add(
        box(0.07, 0.11, 0.6, M.metal, 0, 0, -0.02),
        box(0.06, 0.09, 0.3, M.dark, 0, 0.0, -0.42), // handguard
        tube(0.013, 0.3, M.dark, 0, 0.035, -0.7),
        tube(0.022, 0.2, M.dark, 0, 0.035, -0.82), // silenciador
        box(0.04, 0.06, 0.32, M.dark, 0, 0.1, -0.05), // carry handle
        box(0.025, 0.05, 0.06, M.dark, 0, 0.15, -0.16),
        box(0.05, 0.2, 0.08, M.dark, 0, -0.14, -0.06), // pente
        box(0.05, 0.13, 0.08, M.rubber, 0, -0.1, 0.16),
        box(0.06, 0.09, 0.28, M.dark, 0, 0.0, 0.4), // coronha telescópica
        tube(0.02, 0.28, M.metal, 0, 0.03, 0.4),
      );
      break;
    case "awp":
      g.add(
        box(0.07, 0.12, 0.7, M.olive, 0, 0, 0.05),
        box(0.06, 0.09, 0.3, M.olive, 0, -0.005, -0.45),
        tube(0.016, 0.6, M.dark, 0, 0.04, -0.78),
        tube(0.03, 0.09, M.dark, 0, 0.04, -1.03), // freio de boca
        tube(0.03, 0.34, M.dark, 0, 0.14, -0.1, 10), // luneta
        tube(0.04, 0.05, M.dark, 0, 0.14, -0.28, 10),
        tube(0.034, 0.03, M.glass, 0, 0.14, -0.3, 10),
        box(0.02, 0.06, 0.03, M.dark, 0, 0.1, -0.2),
        box(0.02, 0.06, 0.03, M.dark, 0, 0.1, 0.02),
        box(0.05, 0.12, 0.08, M.olive, 0, -0.13, 0.0), // pente
        box(0.05, 0.14, 0.09, M.olive, 0, -0.11, 0.2), // punho
        box(0.07, 0.12, 0.34, M.olive, 0, -0.01, 0.55), // coronha
        box(0.012, 0.18, 0.012, M.dark, -0.05, -0.1, -0.5, 0.35), // bipé
        box(0.012, 0.18, 0.012, M.dark, 0.05, -0.1, -0.5, -0.35),
      );
      break;
    case "mp5":
      g.add(
        box(0.07, 0.1, 0.36, M.metal, 0, 0, 0.0),
        tube(0.03, 0.22, M.dark, 0, 0.0, -0.3), // handguard cilíndrico
        tube(0.012, 0.14, M.dark, 0, 0.03, -0.46),
        curvedMag(M.metal, 0, -0.14, -0.1, 0.22),
        box(0.05, 0.12, 0.07, M.rubber, 0, -0.1, 0.13),
        box(0.06, 0.08, 0.26, M.dark, 0, 0.0, 0.32),
        box(0.03, 0.06, 0.04, M.dark, 0, 0.08, -0.4),
        tube(0.03, 0.05, M.dark, 0, 0.08, 0.02, 10), // mira circular
      );
      break;
    case "xm1014":
      g.add(
        box(0.07, 0.12, 0.5, M.dark, 0, 0, 0.0),
        tube(0.02, 0.5, M.metal, 0, 0.05, -0.5),
        tube(0.022, 0.42, M.dark, 0, -0.02, -0.46), // tubo do carregador
        box(0.07, 0.08, 0.16, M.rubber, 0, -0.01, -0.32),
        box(0.05, 0.13, 0.08, M.rubber, 0, -0.1, 0.16),
        box(0.06, 0.11, 0.3, M.dark, 0, 0.0, 0.4),
      );
      break;
    case "m3":
      g.add(
        box(0.07, 0.12, 0.44, M.metal, 0, 0, 0.02),
        tube(0.02, 0.5, M.metal, 0, 0.05, -0.5),
        tube(0.02, 0.4, M.dark, 0, -0.01, -0.45),
        box(0.075, 0.09, 0.16, M.wood, 0, -0.01, -0.3), // bomba
        box(0.05, 0.13, 0.08, M.wood, 0, -0.1, 0.18),
        box(0.065, 0.11, 0.3, M.wood, 0, 0.0, 0.4),
      );
      break;
    case "m249":
      g.add(
        box(0.1, 0.16, 0.66, M.olive, 0, 0.01, 0),
        tube(0.022, 0.42, M.dark, 0, 0.05, -0.6),
        box(0.07, 0.1, 0.24, M.dark, 0, 0.0, -0.4),
        box(0.16, 0.2, 0.26, M.olive, 0, -0.18, 0.0), // caixa de munição
        box(0.05, 0.13, 0.08, M.rubber, 0, -0.14, 0.24),
        box(0.08, 0.1, 0.22, M.olive, 0, -0.01, 0.45),
        box(0.03, 0.08, 0.14, M.dark, 0, 0.13, -0.24),
        box(0.012, 0.2, 0.012, M.dark, -0.06, -0.1, -0.5, 0.4),
        box(0.012, 0.2, 0.012, M.dark, 0.06, -0.1, -0.5, -0.4),
      );
      break;
    case "deagle":
      g.add(
        box(0.05, 0.1, 0.3, M.steel, 0, 0.03, -0.08),
        tube(0.012, 0.1, M.dark, 0, 0.045, -0.26),
        box(0.045, 0.16, 0.09, M.rubber, 0, -0.1, 0.06, 0),
        box(0.015, 0.04, 0.03, M.dark, 0, 0.09, -0.2),
        box(0.02, 0.03, 0.03, M.dark, 0, 0.085, 0.04),
      );
      g.children[2].rotation.x = -0.25;
      break;
    case "usp":
      g.add(
        box(0.045, 0.09, 0.26, M.dark, 0, 0.03, -0.06),
        tube(0.02, 0.16, M.metal, 0, 0.04, -0.3), // silenciador
        box(0.04, 0.15, 0.08, M.rubber, 0, -0.09, 0.06),
        box(0.015, 0.03, 0.03, M.dark, 0, 0.085, 0.03),
      );
      g.children[2].rotation.x = -0.25;
      break;
    case "glock":
      g.add(
        box(0.045, 0.08, 0.22, M.dark, 0, 0.03, -0.06),
        tube(0.01, 0.06, M.metal, 0, 0.04, -0.2),
        box(0.04, 0.15, 0.08, M.rubber, 0, -0.09, 0.05),
        box(0.015, 0.03, 0.03, M.dark, 0, 0.08, 0.02),
      );
      g.children[2].rotation.x = -0.2;
      break;
    case "knife": {
      const blade = box(0.006, 0.05, 0.26, M.steel, 0, 0.01, -0.2);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.08, 4), M.steel);
      tip.rotation.x = -Math.PI / 2;
      tip.position.set(0, 0.01, -0.37);
      g.add(blade, tip, box(0.03, 0.05, 0.12, M.rubber, 0, 0, 0.0), box(0.05, 0.07, 0.015, M.dark, 0, 0.01, -0.07));
      break;
    }
    case "claws":
    default: {
      // Garras do zumbi
      for (let i = -1; i <= 1; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.34, 6), M.bone);
        c.rotation.x = -Math.PI / 2;
        c.position.set(i * 0.075, i === 0 ? 0.02 : 0, -0.18);
        g.add(c);
      }
    }
  }
  return g;
}
