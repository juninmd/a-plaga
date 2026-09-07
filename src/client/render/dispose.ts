import * as THREE from "three";

/** Libera geometria e materiais de uma subárvore. Texturas do cache compartilhado ficam vivas. */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh | THREE.Sprite;
    const geo = (mesh as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (geo && !(o instanceof THREE.Sprite)) geo.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
