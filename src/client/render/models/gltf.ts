import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// ===== Modelos GLB de armas (Quaternius "Ultimate Guns", ver README > Créditos) =====
// Cada GLB é normalizado uma vez: cano para -z, empunhadura para baixo, comprimento real em metros,
// origem na empunhadura. Depois é só clonar (geometria compartilhada, material compartilhado).

/** Comprimento alvo (m) de cada arma e para onde o cano do arquivo original aponta. */
const SPEC: Record<string, { file: string; length: number; grip?: number }> = {
  ak47: { file: "ak47", length: 0.9 },
  m4a1: { file: "m4a1", length: 0.95 },
  awp: { file: "awp", length: 1.25 },
  mp5: { file: "mp5", length: 0.7 },
  xm1014: { file: "xm1014", length: 1.05 },
  m3: { file: "m3", length: 1.05 },
  m249: { file: "m249", length: 1.1 },
  deagle: { file: "deagle", length: 0.34 },
  usp: { file: "usp", length: 0.32 },
  glock: { file: "glock", length: 0.28 },
  knife: { file: "knife", length: 0.36 },
};

export interface LoadedWeapon {
  root: THREE.Group;
  /** Caixa no espaço normalizado (cano em -z). */
  box: THREE.Box3;
  muzzle: THREE.Vector3;
  grip: THREE.Vector3;
}

const cache = new Map<string, LoadedWeapon>();
let preload: Promise<void> | null = null;
const loader = new GLTFLoader();

function normalize(scene: THREE.Group, length: number): LoadedWeapon {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  // Os OBJ do pack têm o cano em +x e a coronha perto da origem; gira +x -> -z
  inner.rotation.y = Math.PI / 2;
  inner.add(scene);
  root.add(inner);
  root.updateMatrixWorld(true);
  const raw = new THREE.Box3().setFromObject(root);
  const len = raw.max.z - raw.min.z || 1;
  const s = length / len;
  inner.scale.setScalar(s);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  // Empunhadura: ponto a ~35% do comprimento a partir da coronha, na base do modelo
  const grip = new THREE.Vector3(0, box.min.y + (box.max.y - box.min.y) * 0.15, box.max.z - (box.max.z - box.min.z) * 0.35);
  inner.position.sub(grip);
  root.updateMatrixWorld(true);
  const finalBox = new THREE.Box3().setFromObject(root);
  const muzzle = new THREE.Vector3(0, finalBox.min.y + (finalBox.max.y - finalBox.min.y) * 0.62, finalBox.min.z);
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      const m = o.material as THREE.MeshStandardMaterial;
      if (m && m.isMeshStandardMaterial) {
        m.roughness = 0.55;
        m.metalness = 0.35;
      }
    }
  });
  return { root, box: finalBox, muzzle, grip: new THREE.Vector3(0, 0, 0) };
}

async function loadOne(id: string): Promise<void> {
  const spec = SPEC[id];
  if (!spec) return;
  try {
    const gltf = await loader.loadAsync(`/models/weapons/${spec.file}.glb`);
    cache.set(id, normalize(gltf.scene, spec.length));
  } catch (err) {
    console.warn(`modelo ${id} indisponível, usando procedural`, err);
  }
}

/** Carrega todos os GLB em paralelo; nunca rejeita (quem falhar cai no modelo procedural). */
export function preloadWeaponModels(): Promise<void> {
  if (!preload) preload = Promise.all(Object.keys(SPEC).map(loadOne)).then(() => undefined);
  return preload;
}

export function getWeaponModel(id: string): LoadedWeapon | undefined {
  return cache.get(id);
}

/** Clone leve (compartilha geometria e materiais) já normalizado. */
export function cloneWeapon(id: string): THREE.Group | null {
  const w = cache.get(id);
  if (!w) return null;
  return w.root.clone(true);
}
