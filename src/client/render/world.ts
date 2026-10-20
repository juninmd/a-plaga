import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MAP } from "../../shared/map";
import { IS_MOBILE, sandTexture, tex } from "./textures";
import { pbrMaterial } from "./pbr";
import { buildProps } from "./props";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

// ===== Mundo estático: chão, paredes, arcos, túneis, props, céu, luzes =====

export interface World {
  sky: THREE.Mesh;
  dust: THREE.Points;
  update(dt: number, camPos: THREE.Vector3): void;
}

function boxGeo(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): THREE.BoxGeometry {
  const w = maxX - minX, h = maxY - minY, d = maxZ - minZ;
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  // UVs em metros para a textura repetir de forma uniforme em blocos de qualquer tamanho
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (ny > 0.5) uv.setXY(i, x / 4, z / 4);
    else if (nx > 0.5) uv.setXY(i, z / 4, y / 4);
    else uv.setXY(i, x / 4, y / 4);
  }
  return g;
}

/** Mescla em blocos por quadrante do mapa: um mesh gigante nunca sai do frustum, quatro saem. */
function addMerged(scene: THREE.Scene, geos: THREE.BufferGeometry[], mat: THREE.Material, shadows: boolean) {
  if (geos.length === 0) return;
  const chunks: THREE.BufferGeometry[][] = [[], [], [], []];
  for (const g of geos) {
    g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(new THREE.Vector3());
    chunks[(c.x >= 0 ? 1 : 0) + (c.z >= 0 ? 2 : 0)].push(g);
  }
  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    const mesh = new THREE.Mesh(mergeGeometries(chunk), mat);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

export function buildWorld(scene: THREE.Scene, renderer?: THREE.WebGLRenderer): World {
  const shadows = !IS_MOBILE;

  // --- Iluminação: sol de fim de tarde empoeirado ---
  scene.background = new THREE.Color(0x8c7a5c);
  scene.fog = new THREE.Fog(0xcdbf9f, IS_MOBILE ? 55 : 80, IS_MOBILE ? 140 : 210);
  scene.add(new THREE.HemisphereLight(0xe6d6b4, 0x7a6340, 1.3));
  scene.add(new THREE.AmbientLight(0x8a7a60, 0.45));
  const sun = new THREE.DirectionalLight(0xffe0b0, 1.35);
  sun.position.set(50, 70, 20);
  sun.castShadow = shadows;
  if (shadows) {
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -95;
    sun.shadow.camera.right = 95;
    sun.shadow.camera.top = 95;
    sun.shadow.camera.bottom = -95;
    sun.shadow.camera.far = 250;
    sun.shadow.bias = -0.0008;
  }
  scene.add(sun);

  // --- Céu HDRI (Poly Haven, CC0): reflexo/ambiente reais + sol alinhado com o disco do céu ---
  if (renderer) {
    new RGBELoader().load("/env/sky.hdr", (hdr) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromEquirectangular(hdr).texture;
      scene.environmentIntensity = 1.25;
      scene.background = hdr;
      scene.backgroundIntensity = 1.0;
      scene.backgroundBlurriness = 0.0;
      pmrem.dispose();
      const dir = brightestDirection(hdr);
      if (dir) sun.position.copy(dir.multiplyScalar(90));
      skyDome.visible = false;
    });
  }

  let skyDome: THREE.Object3D = new THREE.Object3D(); // preenchido adiante; o HDRI esconde o domo de degradê

  // --- Chão ---
  const floorMat = pbrMaterial("sand", { color: 0xf0dcb0, roughness: 1, repeat: 1, normalScale: 0.8 });
  (floorMat.map as THREE.Texture).repeat.set(MAP.size.x / 2.5, MAP.size.z / 2.5);
  (floorMat.normalMap as THREE.Texture).repeat.set(MAP.size.x / 2.5, MAP.size.z / 2.5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAP.size.x * 2, MAP.size.z * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // --- Geometria estática mesclada por material ---
  const stone = pbrMaterial("brick", { color: 0xffe6c0, roughness: 0.95, normalScale: 1.3 });
  const stoneDark = pbrMaterial("concrete", { color: 0xbfae90, roughness: 0.95, normalScale: 1.0 });
  const plank = pbrMaterial("wood", { color: 0xd8b890, roughness: 0.85 });
  const concrete = pbrMaterial("concrete", { color: 0xd0c8b8, roughness: 0.92 });

  const walls: THREE.BufferGeometry[] = [];
  const caps: THREE.BufferGeometry[] = [];
  const bases: THREE.BufferGeometry[] = [];
  const crates: THREE.BufferGeometry[] = [];
  const slabs: THREE.BufferGeometry[] = [];
  const pillars: THREE.BufferGeometry[] = [];
  for (const b of MAP.boxes) {
    const { min, max } = b;
    switch (b.kind) {
      case "wall": {
        walls.push(boxGeo(min.x, min.y, min.z, max.x, max.y, max.z));
        // Parapeito no topo (silhueta de telhado) e rodapé escuro
        caps.push(boxGeo(min.x - 0.15, max.y, min.z - 0.15, max.x + 0.15, max.y + 0.5, max.z + 0.15));
        bases.push(boxGeo(min.x - 0.04, 0, min.z - 0.04, max.x + 0.04, 0.6, max.z + 0.04));
        break;
      }
      case "arch": {
        // Verga de pedra sobre a passagem + vigas de madeira embaixo
        slabs.push(boxGeo(min.x, min.y, min.z, max.x, max.y, max.z));
        crates.push(boxGeo(min.x, min.y - 0.25, min.z + 0.3, max.x, min.y, min.z + 0.6));
        crates.push(boxGeo(min.x, min.y - 0.25, max.z - 0.6, max.x, min.y, max.z - 0.3));
        break;
      }
      case "roof": {
        slabs.push(boxGeo(min.x, min.y, min.z, max.x, max.y, max.z));
        break;
      }
      case "crate":
      case "low":
        crates.push(boxGeo(min.x, min.y, min.z, max.x, max.y, max.z));
        break;
      case "pillar":
      case "platform":
      case "step":
        pillars.push(boxGeo(min.x, min.y, min.z, max.x, max.y, max.z));
        break;
      case "barrel":
        break; // desenhado como cilindro abaixo
    }
  }
  addMerged(scene, walls, stone, shadows);
  addMerged(scene, caps, stoneDark, false);
  addMerged(scene, bases, stoneDark, false);
  addMerged(scene, slabs, stoneDark, shadows);
  addMerged(scene, crates, plank, shadows);
  addMerged(scene, pillars, concrete, shadows);

  // --- Props 3D (barris, pneus, sacos, galões) carregados em segundo plano ---
  void buildProps(scene);

  // --- Decoração determinística perto dos spawns: sacos de areia e tábuas ---
  const sandbag = new THREE.MeshStandardMaterial({ map: tex("sand", sandTexture), color: 0x9a8a66, roughness: 1 });
  const bagGeos: THREE.BufferGeometry[] = [];
  const decor = [
    { x: MAP.spawns[0].pos.x - 3, z: MAP.spawns[0].pos.z + 6, rot: 0.2 },
    { x: MAP.spawns[3].pos.x + 3, z: MAP.spawns[3].pos.z + 6, rot: -0.3 },
    { x: MAP.zombieSpawns[1].pos.x, z: MAP.zombieSpawns[1].pos.z - 5, rot: 0.6 },
    { x: MAP.zombieSpawns[4].pos.x, z: MAP.zombieSpawns[4].pos.z - 5, rot: -0.5 },
  ];
  for (const d of decor) {
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 3 - row; i++) {
        const g = new THREE.SphereGeometry(0.42, 8, 6);
        g.scale(1.3, 0.55, 0.8);
        const off = (i - (2 - row) / 2) * 0.95;
        g.rotateY(d.rot);
        g.translate(d.x + Math.cos(d.rot) * off, 0.22 + row * 0.42, d.z + Math.sin(d.rot) * off);
        bagGeos.push(g);
      }
    }
  }
  addMerged(scene, bagGeos, sandbag, shadows);
  const plankGeos: THREE.BufferGeometry[] = [];
  const leaning = [
    { x: MAP.spawns[0].pos.x - 6, z: MAP.spawns[0].pos.z - 5.4, ry: 0 },
    { x: MAP.zombieSpawns[0].pos.x + 2, z: MAP.zombieSpawns[0].pos.z + 5.4, ry: Math.PI },
  ];
  for (const l of leaning) {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.BoxGeometry(0.3, 2.6, 0.06);
      g.rotateX(-0.35);
      g.rotateY(l.ry);
      g.translate(l.x + i * 0.4, 1.2, l.z);
      plankGeos.push(g);
    }
  }
  addMerged(scene, plankGeos, plank, shadows);

  // --- Céu: domo com gradiente + sol ---
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 4;
  skyCanvas.height = 128;
  const sctx = skyCanvas.getContext("2d")!;
  const grad = sctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "#1d3a44");
  grad.addColorStop(0.45, "#6f7f74");
  grad.addColorStop(0.75, "#c99a5e");
  grad.addColorStop(1, "#e6b070");
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 4, 128);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -10;
  scene.add(sky);
  skyDome = sky;
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(9, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff1c8, fog: false, transparent: true, opacity: 0.95 }),
  );
  sunDisc.position.set(120, 110, 50);
  sunDisc.lookAt(0, 0, 0);
  sky.add(sunDisc);

  // --- Poeira no ar ---
  const n = IS_MOBILE ? 120 : 400;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = (Math.random() - 0.5) * 60;
    arr[i * 3 + 1] = Math.random() * 6;
    arr[i * 3 + 2] = (Math.random() - 0.5) * 60;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ color: 0xe8d4a8, size: 0.08, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  scene.add(dust);

  let t = 0;
  return {
    sky,
    dust,
    update(dt, camPos) {
      t += dt;
      sky.position.copy(camPos);
      // A nuvem de poeira acompanha a câmera e deriva devagar
      dust.position.set(camPos.x + Math.sin(t * 0.1) * 2, 0, camPos.z + Math.cos(t * 0.13) * 2);
      dust.rotation.y = t * 0.01;
    },
  };
}

/** Direção (mundo) do texel mais brilhante do HDRI = o sol. */
function brightestDirection(tex: THREE.DataTexture): THREE.Vector3 | null {
  const img = tex.image as { data: ArrayLike<number>; width: number; height: number };
  const { data, width, height } = img;
  if (!data || !width) return null;
  const half = data instanceof Uint16Array;
  const val = (i: number) => (half ? THREE.DataUtils.fromHalfFloat(data[i] as number) : (data[i] as number));
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const l = val(i) + val(i + 1) + val(i + 2);
      if (l > best) { best = l; bx = x; by = y; }
    }
  }
  const az = ((bx + 0.5) / width - 0.5) * Math.PI * 2;
  const el = (0.5 - (by + 0.5) / height) * Math.PI; // linha 0 = topo
  const e = Math.abs(el); // o sol está sempre acima do horizonte
  return new THREE.Vector3(Math.cos(az) * Math.cos(e), Math.sin(e), Math.sin(az) * Math.cos(e)).normalize();
}
