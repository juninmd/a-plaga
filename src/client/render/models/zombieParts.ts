import * as THREE from "three";
import { rottenSkinTexture, tex } from "../textures";

// ===== Visual de zumbi sobre o rig do soldado: cabeça apodrecida, sangue/necrose no corpo e acessórios por classe =====

/** Remove da malha os triângulos cujo osso dominante bate com `drop` (ex.: o capacete). */
export function dropBones(mesh: THREE.SkinnedMesh, drop: RegExp): THREE.BufferGeometry {
  const geo = mesh.geometry.clone();
  const si = geo.getAttribute("skinIndex");
  const sw = geo.getAttribute("skinWeight");
  const bones = mesh.skeleton.bones;
  const count = geo.getAttribute("position").count;
  const dropV = new Uint8Array(count);
  for (let v = 0; v < count; v++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(v, k);
      if (w > bw) { bw = w; best = si.getComponent(v, k); }
    }
    dropV[v] = drop.test(bones[best]?.name ?? "") ? 1 : 0;
  }
  const src = geo.index;
  const out: number[] = [];
  const tris = src ? src.count / 3 : count / 3;
  for (let t = 0; t < tris; t++) {
    const a = src ? src.getX(t * 3) : t * 3;
    const b = src ? src.getX(t * 3 + 1) : t * 3 + 1;
    const c = src ? src.getX(t * 3 + 2) : t * 3 + 2;
    // Só descarta se o triângulo inteiro é do osso (mantém a borda do pescoço)
    if (!(dropV[a] && dropV[b] && dropV[c])) out.push(a, b, c);
  }
  geo.setIndex(out);
  return geo;
}

/**
 * Sangue seco e necrose procedurais por cima da textura do uniforme (ruído em espaço do objeto, sem UV extra).
 * `gore` 0..1 controla quanto sangue.
 */
export function applyRot(mat: THREE.MeshStandardMaterial, gore: number, seed: number) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uGore = { value: gore };
    shader.uniforms.uSeed = { value: seed };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObj;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvObj = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vObj;
uniform float uGore;
uniform float uSeed;
float h3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3) + uSeed); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ return 0.55*n3(p) + 0.3*n3(p*2.1) + 0.15*n3(p*4.3); }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
{
  vec3 q = vObj * 0.045;
  float rot = fbm(q * 3.0);
  float blood = smoothstep(0.68 - uGore * 0.1, 0.8 - uGore * 0.06, fbm(q * 2.2 + 7.0));
  float drip = smoothstep(0.72, 0.95, fbm(vec3(q.x * 6.0, q.y * 1.2, q.z * 6.0) + 3.0));
  diffuseColor.rgb *= mix(0.5, 1.0, rot) * vec3(0.92, 1.0, 0.9);                      // sujeira / necrose
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.012, 0.016), max(blood, drip * 0.7) * (0.5 + uGore * 0.35));
}`,
      );
  };
  mat.customProgramCacheKey = () => `rot${gore.toFixed(2)}-${seed}`;
  mat.needsUpdate = true;
}

function mount(bone: THREE.Object3D, obj: THREE.Object3D, model: THREE.Object3D): void {
  model.updateWorldMatrix(true, true);
  const ws = new THREE.Vector3();
  bone.getWorldScale(ws);
  const wrap = new THREE.Group();
  wrap.scale.setScalar(1 / (ws.x || 1)); // o osso herda a escala do rig; os acessórios são desenhados em metros
  wrap.add(obj);
  bone.add(wrap);
}

const sph = (r: number, ws = 12, hs = 10) => new THREE.SphereGeometry(r, ws, hs);

export interface ZombieKit {
  materials: THREE.Material[];
}

/** Cabeça, olhos e acessórios por classe. `bones` são buscados por nome (sem prefixo). */
export function dressZombie(model: THREE.Object3D, classId: string, tint: number, eye: number): ZombieKit {
  const materials: THREE.Material[] = [];
  const find = (n: string) => model.getObjectByName(`mixamorig${n}`) ?? model.getObjectByName(`mixamorig:${n}`) ?? null;
  const track = <T extends THREE.Material>(m: T): T => (materials.push(m), m);

  const flesh = track(new THREE.MeshStandardMaterial({ map: tex(`zhead${tint}`, () => rottenSkinTexture(tint)), color: 0xffffff, roughness: 1 }));
  const dark = track(new THREE.MeshStandardMaterial({ color: 0x1b0f0c, roughness: 1 }));
  const bone = track(new THREE.MeshStandardMaterial({ color: 0xd9d2b8, roughness: 0.7 }));
  const eyeMat = track(new THREE.MeshBasicMaterial({ color: eye, fog: false }));

  const headBone = find("Head");
  if (headBone) {
    const head = new THREE.Group();
    // Crânio ligeiramente deformado, maxilar aberto, olhos brilhantes
    const skull = new THREE.Mesh(sph(0.115, 14, 12), flesh);
    skull.scale.set(0.92, 1.08, 1.0);
    skull.position.set(0, 0.1, 0.0);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.045, 0.1), flesh);
    jaw.position.set(0, 0.015, -0.035);
    jaw.rotation.x = 0.35;
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.04), dark);
    mouth.position.set(0, 0.04, -0.075);
    head.add(skull, jaw, mouth);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(sph(0.018, 8, 6), eyeMat);
      e.position.set(sx * 0.04, 0.12, -0.095);
      head.add(e);
    }
    // dentes
    for (let i = -2; i <= 2; i++) {
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.02, 4), bone);
      t.position.set(i * 0.014, 0.052, -0.098);
      t.rotation.x = Math.PI;
      head.add(t);
    }
    // Eixos do osso: Y para cima ao longo do pescoço, o rosto fica em +Z local do rig; ajustado visualmente
    head.rotation.y = Math.PI;
    mount(headBone, head, model);
    addClassParts(classId, headBone, find, model, { flesh, dark, bone, eyeMat, track });
  }
  return { materials };
}

interface Mats {
  flesh: THREE.Material;
  dark: THREE.Material;
  bone: THREE.Material;
  eyeMat: THREE.Material;
  track: <T extends THREE.Material>(m: T) => T;
}

function addClassParts(classId: string, headBone: THREE.Object3D, find: (n: string) => THREE.Object3D | null, model: THREE.Object3D, m: Mats) {
  const spine2 = find("Spine2");
  const spine = find("Spine");
  switch (classId) {
    case "tank": {
      // Espinhos ósseos nos ombros e costas
      if (spine2) {
        const g = new THREE.Group();
        for (const sx of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            const c = new THREE.Mesh(new THREE.ConeGeometry(0.03 - i * 0.004, 0.16 - i * 0.03, 5), m.bone);
            c.position.set(sx * (0.2 + i * 0.015), 0.1 + i * 0.045, 0.02);
            c.rotation.z = -sx * (0.7 + i * 0.1);
            g.add(c);
          }
        }
        mount(spine2, g, model);
      }
      break;
    }
    case "boomer": {
      // Barriga inchada com bile
      if (spine) {
        const bile = m.track(new THREE.MeshStandardMaterial({ color: 0xb6d24a, emissive: 0x3a4a08, roughness: 0.4 }));
        const belly = new THREE.Mesh(sph(0.2, 14, 12), bile);
        belly.scale.set(1.1, 0.95, 0.9);
        belly.position.set(0, 0.13, 0.12);
        const g = new THREE.Group();
        g.add(belly);
        for (let i = 0; i < 4; i++) {
          const b = new THREE.Mesh(sph(0.05, 8, 6), bile);
          b.position.set((i - 1.5) * 0.09, 0.2 + (i % 2) * 0.05, 0.28);
          g.add(b);
        }
        mount(spine, g, model);
      }
      break;
    }
    case "smoker": {
      // Capuz e língua comprida
      const hood = new THREE.Mesh(sph(0.135, 12, 10), m.track(new THREE.MeshStandardMaterial({ color: 0x2a3330, roughness: 1 })));
      hood.scale.set(0.95, 1.0, 1.05);
      hood.position.set(0, 0.105, 0.025);
      const tongue = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, 0.38, 6), m.track(new THREE.MeshStandardMaterial({ color: 0xb04a5a, roughness: 0.5 })));
      tongue.position.set(0, -0.12, -0.09);
      const g = new THREE.Group();
      g.rotation.y = Math.PI;
      g.add(hood);
      g.add(tongue);
      mount(headBone, g, model);
      break;
    }
    case "spitter": {
      // Sacos de ácido no pescoço
      const acid = m.track(new THREE.MeshStandardMaterial({ color: 0x6aff9a, emissive: 0x0e5a2a, roughness: 0.3 }));
      const g = new THREE.Group();
      for (const sx of [-1, 1]) {
        const s = new THREE.Mesh(sph(0.055, 10, 8), acid);
        s.position.set(sx * 0.085, 0.0, -0.02);
        g.add(s);
      }
      mount(headBone, g, model);
      break;
    }
    case "witch": {
      // Cabelo longo e ralo
      const hair = m.track(new THREE.MeshStandardMaterial({ color: 0x100a14, roughness: 1, side: THREE.DoubleSide }));
      const g = new THREE.Group();
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const strand = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.5 + (i % 3) * 0.1), hair);
        strand.position.set(Math.cos(a) * 0.09, -0.12, Math.sin(a) * 0.09 + 0.04);
        strand.rotation.y = a + Math.PI / 2;
        g.add(strand);
      }
      mount(headBone, g, model);
      break;
    }
    case "nemesis": {
      // Chifres e carapaça
      const g = new THREE.Group();
      for (const sx of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.26, 6), m.bone);
        h.position.set(sx * 0.09, 0.22, -0.01);
        h.rotation.z = -sx * 0.5;
        g.add(h);
      }
      mount(headBone, g, model);
      if (spine2) {
        const sp = new THREE.Group();
        for (let i = 0; i < 5; i++) {
          const c = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 5), m.bone);
          c.position.set((i - 2) * 0.07, 0.12 + (i % 2) * 0.03, -0.14);
          c.rotation.x = -0.5;
          sp.add(c);
        }
        mount(spine2, sp, model);
      }
      break;
    }
    default:
      break;
  }
}
