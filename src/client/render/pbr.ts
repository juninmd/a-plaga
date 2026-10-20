import * as THREE from "three";
import { IS_MOBILE } from "./textures";

// ===== Texturas PBR (Poly Haven, CC0): diffuse + normal em public/textures =====
// Mobile carrega a versão de 512 px (_m).

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();

function load(path: string, srgb: boolean, repeat: number): THREE.Texture {
  const key = `${path}|${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const t = loader.load(path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = IS_MOBILE ? 2 : 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export interface PbrOpts {
  color?: number;
  roughness?: number;
  metalness?: number;
  repeat?: number;
  normalScale?: number;
}

/** Material com mapa de cor + normal. `name` = arquivo base em public/textures (sand, plaster, brick, wood, rust, concrete). */
export function pbrMaterial(name: string, o: PbrOpts = {}): THREE.MeshStandardMaterial {
  const sfx = IS_MOBILE ? "_m" : "";
  const rep = o.repeat ?? 1;
  const m = new THREE.MeshStandardMaterial({
    map: load(`/textures/${name}_diff${sfx}.jpg`, true, rep),
    normalMap: load(`/textures/${name}_nor${sfx}.jpg`, false, rep),
    color: o.color ?? 0xffffff,
    roughness: o.roughness ?? 0.9,
    metalness: o.metalness ?? 0,
  });
  const ns = o.normalScale ?? 1;
  m.normalScale.set(ns, ns);
  return m;
}
