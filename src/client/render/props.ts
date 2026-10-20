import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MAP } from "../../shared/map";
import { IS_MOBILE } from "./textures";

// ===== Props 3D (Poly Haven, CC0): barris, pneus, sacos de cimento, galões — espalhados junto às paredes =====

const loader = new GLTFLoader();

interface PropDef {
  /** Pasta/arquivo em public/models/props. */
  id: string;
  /** Altura-alvo (m) de UMA unidade. */
  height: number;
}

const DEFS: Record<string, PropDef> = {
  barrel: { id: "Barrel_01", height: 1.2 },
  tyre: { id: "old_tyre", height: 0.3 },
  bag: { id: "cement_bag", height: 0.22 },
  can: { id: "metal_jerrycan", height: 0.5 },
};

interface Loaded {
  root: THREE.Group;
  scale: number;
}

async function loadProp(def: PropDef): Promise<Loaded | null> {
  try {
    const g = await loader.loadAsync(`/models/props/${def.id}/${def.id}.gltf`);
    g.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = !IS_MOBILE;
        o.receiveShadow = true;
      }
    });
    const box = new THREE.Box3().setFromObject(g.scene);
    const size = box.getSize(new THREE.Vector3());
    // Apoia no chão e centra em XZ
    g.scene.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const root = new THREE.Group();
    root.add(g.scene);
    return { root, scale: def.height / (size.y || 1) };
  } catch (err) {
    console.warn(`prop ${def.id} indisponível`, err);
    return null;
  }
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const freeSpot = (x: number, z: number, margin: number): boolean => {
  if (Math.abs(x) > MAP.size.x - 1 || Math.abs(z) > MAP.size.z - 1) return false;
  for (const b of MAP.boxes) {
    if (x > b.min.x - margin && x < b.max.x + margin && z > b.min.z - margin && z < b.max.z + margin) return false;
  }
  for (const s of [...MAP.spawns, ...MAP.zombieSpawns]) {
    if (Math.hypot(x - s.pos.x, z - s.pos.z) < 5) return false; // não atrapalha o spawn
  }
  return true;
};

/** Barris no lugar dos cilindros + decoração deterministica junto às paredes (sem colisão, fora da passagem). */
export async function buildProps(scene: THREE.Scene): Promise<void> {
  const [barrel, tyre, bag, can] = await Promise.all([loadProp(DEFS.barrel), loadProp(DEFS.tyre), loadProp(DEFS.bag), loadProp(DEFS.can)]);
  const place = (l: Loaded | null, x: number, y: number, z: number, ry: number, k = 1) => {
    if (!l) return;
    const o = l.root.clone(true);
    o.scale.setScalar(l.scale * k);
    o.position.set(x, y, z);
    o.rotation.y = ry;
    scene.add(o);
  };

  // Barris sólidos do mapa (colisão já existe): modelo real
  if (barrel) for (const p of MAP.props) if (p.kind === "barrel") place(barrel, p.pos.x, 0, p.pos.z, p.pos.x * 7.3 + p.pos.z);

  // Decoração ao pé das paredes
  const rnd = mulberry32(20261020);
  let count = 0;
  const maxCount = IS_MOBILE ? 14 : 34;
  for (const b of MAP.boxes) {
    if (b.kind !== "wall" || count >= maxCount) continue;
    const faces: { x: number; z: number; nx: number; nz: number; len: number; tx: number; tz: number }[] = [
      { x: b.max.x, z: b.min.z, nx: 1, nz: 0, len: b.max.z - b.min.z, tx: 0, tz: 1 },
      { x: b.min.x, z: b.min.z, nx: -1, nz: 0, len: b.max.z - b.min.z, tx: 0, tz: 1 },
      { x: b.min.x, z: b.max.z, nx: 0, nz: 1, len: b.max.x - b.min.x, tx: 1, tz: 0 },
      { x: b.min.x, z: b.min.z, nx: 0, nz: -1, len: b.max.x - b.min.x, tx: 1, tz: 0 },
    ];
    for (const f of faces) {
      for (let t = 2; t < f.len - 1; t += 3.2) {
        if (rnd() > 0.2 || count >= maxCount) continue;
        const kind = rnd();
        const off = 0.6;
        const x = f.x + f.nx * off + f.tx * t;
        const z = f.z + f.nz * off + f.tz * t;
        if (!freeSpot(x, z, 0.45)) continue;
        const ry = Math.atan2(f.nx, f.nz);
        count++;
        if (kind < 0.35) {
          // pilha de pneus
          const n = 2 + Math.floor(rnd() * 3);
          for (let i = 0; i < n; i++) place(tyre, x + (rnd() - 0.5) * 0.04, i * 0.28, z + (rnd() - 0.5) * 0.04, rnd() * 6, 1.6);
        } else if (kind < 0.7) {
          // pilha de sacos de cimento
          for (let r = 0; r < 2; r++) for (let i = 0; i < 2 - r; i++) {
            const ox = (i - (1 - r) / 2) * 0.62;
            place(bag, x + f.tx * ox, r * 0.2, z + f.tz * ox, ry + (rnd() - 0.5) * 0.3, 2.2);
          }
        } else if (kind < 0.9) {
          place(can, x, 0, z, ry + rnd());
          place(can, x + f.tx * 0.4, 0, z + f.tz * 0.4, ry + rnd(), 1);
        } else if (barrel) {
          place(barrel, x, 0, z, rnd() * 6, 0.9);
        }
      }
    }
  }
}
