import * as THREE from "three";
import { MAP, worldX, worldZ } from "../../shared/map";
import { IS_MOBILE } from "./textures";

// ===== Noite: lanternas de parede, fogueiras em barris, holofotes dos spawns e letreiros de néon =====
// Dezenas de fontes visuais (bulbo emissivo + brilho aditivo) e um POOL fixo de PointLights reais que seguem as
// fontes mais próximas da câmera — o número de luzes do shader nunca muda (mudar recompila todos os materiais).

export interface Night {
  update(dt: number, camPos: THREE.Vector3): void;
}

interface Source {
  pos: THREE.Vector3;
  color: number;
  intensity: number;
  distance: number;
  /** 0 = estável; >0 = oscila (fogo, lâmpada com defeito). */
  flicker: number;
  phase: number;
}

interface PoolLight {
  light: THREE.PointLight;
  src: Source | null; // fonte que esta luz mostra agora (mantida durante o fade-out)
  want: boolean;
  level: number; // 0..1 (fade ao trocar de fonte, sem "pop")
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

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.65)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.16)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flameTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 92, 2, 32, 80, 56);
  grad.addColorStop(0, "rgba(255,240,170,1)");
  grad.addColorStop(0.35, "rgba(255,150,40,0.85)");
  grad.addColorStop(1, "rgba(255,60,0,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(32, 4);
  g.bezierCurveTo(60, 50, 58, 100, 32, 124);
  g.bezierCurveTo(6, 100, 4, 50, 32, 4);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function neonTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(0,0,0,0.85)";
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(10, 10, 492, 108);
  g.font = "700 76px Rajdhani, 'Arial Narrow', sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = color;
  g.shadowBlur = 24;
  g.fillStyle = color;
  g.fillText(text, 256, 68);
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Face {
  pos: THREE.Vector3; // ponto na face da parede
  normal: THREE.Vector3; // para fora da parede
}

/** Pontos ao longo das faces das paredes (a cada ~3 m) onde dá para pendurar algo, longe de portas/arcos. */
function wallFaces(): Face[] {
  const out: Face[] = [];
  for (const b of MAP.boxes) {
    if (b.kind !== "wall") continue;
    const faces = [
      { x: b.max.x, z: b.min.z, nx: 1, nz: 0, len: b.max.z - b.min.z, tx: 0, tz: 1 },
      { x: b.min.x, z: b.min.z, nx: -1, nz: 0, len: b.max.z - b.min.z, tx: 0, tz: 1 },
      { x: b.min.x, z: b.max.z, nx: 0, nz: 1, len: b.max.x - b.min.x, tx: 1, tz: 0 },
      { x: b.min.x, z: b.min.z, nx: 0, nz: -1, len: b.max.x - b.min.x, tx: 1, tz: 0 },
    ];
    for (const f of faces) {
      for (let t = 2; t < f.len - 2; t += 3) {
        const px = f.x + f.tx * t + f.nx * 0.02;
        const pz = f.z + f.tz * t + f.nz * 0.02;
        // Fora de outra caixa (parede encostada) e dentro do mapa
        const probe = { x: px + f.nx * 0.6, z: pz + f.nz * 0.6 };
        if (Math.abs(probe.x) > MAP.size.x - 1 || Math.abs(probe.z) > MAP.size.z - 1) continue;
        if (MAP.boxes.some((o) => probe.x > o.min.x && probe.x < o.max.x && probe.z > o.min.z && probe.z < o.max.z)) continue;
        out.push({ pos: new THREE.Vector3(px, 0, pz), normal: new THREE.Vector3(f.nx, 0, f.nz) });
      }
    }
  }
  return out;
}

export function buildNight(scene: THREE.Scene): Night {
  const rnd = mulberry32(777001);
  const glowTex = glowTexture();
  const sources: Source[] = [];
  const faces = wallFaces();
  const group = new THREE.Group();
  scene.add(group);

  const glowMats = new Map<number, THREE.SpriteMaterial>();
  const glow = (color: number, size: number, opacity = 0.9): THREE.Sprite => {
    let m = glowMats.get(color);
    if (!m) {
      m = new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false });
      glowMats.set(color, m);
    }
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    s.material.opacity = opacity;
    return s;
  };

  // ---------- Lanternas de parede ----------
  const maxLamps = IS_MOBILE ? 34 : 72;
  const lamps: { pos: THREE.Vector3; n: THREE.Vector3; color: number; kind: "warm" | "cold" | "red" | "green" }[] = [];
  const near = (p: THREE.Vector3, r: number) => lamps.some((l) => l.pos.distanceTo(p) < r);
  const pick = (target: { x: number; z: number } | null, radius: number, kind: "warm" | "cold" | "red" | "green", color: number, minSep: number) => {
    const cand = faces.filter((f) => !target || Math.hypot(f.pos.x - target.x, f.pos.z - target.z) < radius);
    for (let tries = 0; tries < 40 && cand.length; tries++) {
      const f = cand[Math.floor(rnd() * cand.length)];
      const p = f.pos.clone();
      p.y = 2.7 + rnd() * 0.6;
      if (near(p, minSep)) continue;
      lamps.push({ pos: p.addScaledVector(f.normal, 0.28), n: f.normal, color, kind });
      return;
    }
  };
  // Spawns: humanos com holofote frio, zumbis com luz vermelha/tóxica
  for (const sp of MAP.spawns.slice(0, 4)) pick(sp.pos, 14, "cold", 0xbcd6ff, 6);
  for (const sp of MAP.zombieSpawns.slice(0, 5)) pick(sp.pos, 14, rnd() < 0.5 ? "red" : "green", rnd() < 0.5 ? 0xff3b2a : 0x4dff72, 6);
  // O resto do mapa: lanternas quentes espaçadas
  for (let i = 0; lamps.length < maxLamps && i < 400; i++) pick(null, 0, "warm", 0xffb45e, 6.5);

  const addSource = (pos: THREE.Vector3, color: number, intensity: number, distance: number, flicker = 0) =>
    sources.push({ pos: pos.clone(), color, intensity, distance, flicker, phase: rnd() * 10 });

  // Geometria das lanternas: suporte + carcaça (mescladas) + bulbo emissivo instanciado
  const bracketMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.6, metalness: 0.7 });
  const bulbGeo = new THREE.SphereGeometry(0.13, 10, 8);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, Math.max(1, lamps.length));
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  lamps.forEach((l, i) => {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.3), bracketMat);
    arm.position.copy(l.pos).addScaledVector(l.n, -0.14);
    arm.lookAt(arm.position.clone().add(l.n));
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.32, 8, 1, true), bracketMat);
    cage.position.copy(l.pos);
    group.add(arm, cage);
    tmp.position.copy(l.pos);
    tmp.updateMatrix();
    bulbs.setMatrixAt(i, tmp.matrix);
    bulbs.setColorAt(i, col.setHex(l.color).multiplyScalar(4)); // >1: entra no bloom
    const g = glow(l.color, l.kind === "warm" ? 5.0 : 6.0, 0.95);
    g.position.copy(l.pos);
    group.add(g);
    // Luz real fica no pool; aqui só registra a fonte (levemente afastada da parede)
    const lp = l.pos.clone().addScaledVector(l.n, 0.5);
    addSource(lp, l.color, l.kind === "warm" ? 34 : 44, l.kind === "warm" ? 17 : 20, rnd() < 0.18 ? 0.35 : 0);
  });
  bulbs.instanceColor!.needsUpdate = true;
  group.add(bulbs);

  // ---------- Fogueiras em barris ----------
  const flameTex = flameTexture();
  const flames: { sprites: THREE.Sprite[]; base: THREE.Vector3; seed: number }[] = [];
  const barrels = MAP.props.filter((p) => p.kind === "barrel");
  barrels.forEach((b, i) => {
    if (i % 2 !== 0) return;
    const base = new THREE.Vector3(b.pos.x, 1.25, b.pos.z);
    const sprites: THREE.Sprite[] = [];
    for (let k = 0; k < 3; k++) {
      const m = new THREE.SpriteMaterial({ map: flameTex, color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false });
      const s = new THREE.Sprite(m);
      s.position.copy(base);
      group.add(s);
      sprites.push(s);
    }
    const halo = glow(0xff8a2a, 3.2, 0.7);
    halo.position.copy(base).add(new THREE.Vector3(0, 0.3, 0));
    group.add(halo);
    flames.push({ sprites, base, seed: rnd() * 10 });
    addSource(base.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xff7a22, 40, 18, 0.55);
  });

  // ---------- Letreiros de néon ----------
  const signs: [string, string, { x: number; z: number }][] = [
    ["SITE A", "#ff4455", { x: worldX(22), z: worldZ(2) }],
    ["SITE B", "#3ad6ff", { x: worldX(2), z: worldZ(2) }],
    ["MID", "#7dff6a", { x: worldX(13), z: worldZ(9) }],
    ["TÚNEIS", "#ffb02e", { x: worldX(3), z: worldZ(9) }],
    ["LONG", "#ff59d8", { x: worldX(21), z: worldZ(14) }],
    ["PLAGA", "#9dff3a", { x: worldX(12), z: worldZ(23) }],
  ];
  for (const [text, color, at] of signs) {
    const f = faces
      .filter((x) => Math.hypot(x.pos.x - at.x, x.pos.z - at.z) < 14)
      .sort((a, b) => Math.hypot(a.pos.x - at.x, a.pos.z - at.z) - Math.hypot(b.pos.x - at.x, b.pos.z - at.z))[0];
    if (!f) continue;
    const mat = new THREE.MeshBasicMaterial({ map: neonTexture(text, color), toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), mat);
    plane.position.copy(f.pos).addScaledVector(f.normal, 0.06);
    plane.position.y = 5.2;
    plane.lookAt(plane.position.clone().add(f.normal));
    group.add(plane);
    const halo = glow(new THREE.Color(color).getHex(), 7, 0.35);
    halo.position.copy(plane.position).addScaledVector(f.normal, 0.5);
    group.add(halo);
    addSource(plane.position.clone().addScaledVector(f.normal, 1.4), new THREE.Color(color).getHex(), 26, 15, 0);
  }

  // ---------- Pool de PointLights reais ----------
  const POOL = IS_MOBILE ? 4 : 8;
  const pool: PoolLight[] = [];
  for (let i = 0; i < POOL; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 16, 1.6);
    light.castShadow = false;
    scene.add(light);
    pool.push({ light, src: null, want: false, level: 0 });
  }
  const wantList: Source[] = [];
  let reassign = 0;
  let time = 0;

  return {
    update(dt, cam) {
      time += dt;
      reassign -= dt;
      if (reassign <= 0) {
        reassign = 0.2;
        // Fontes mais próximas (distância 2D, ignora altura)
        wantList.length = 0;
        const ranked = sources
          .map((s) => ({ s, d: Math.hypot(s.pos.x - cam.x, s.pos.z - cam.z) }))
          .filter((o) => o.d < 38)
          .sort((a, b) => a.d - b.d)
          .slice(0, POOL);
        for (const r of ranked) wantList.push(r.s);
        // Quem já ilumina uma fonte desejada continua; as demais apagam (fade) e só então pegam uma fonte nova
        const shown = new Set<Source>();
        for (const pl of pool) {
          pl.want = !!pl.src && wantList.includes(pl.src);
          if (pl.want && pl.src) shown.add(pl.src);
        }
        const fresh = wantList.filter((s) => !shown.has(s));
        for (const pl of pool) {
          if (pl.want || pl.level > 0.04 || !fresh.length) continue;
          const s = fresh.shift()!;
          pl.src = s;
          pl.want = true;
          pl.light.position.copy(s.pos);
          pl.light.color.setHex(s.color);
          pl.light.distance = s.distance;
        }
      }
      for (const pl of pool) {
        pl.level += ((pl.want ? 1 : 0) - pl.level) * Math.min(1, dt * 6);
        const s = pl.src;
        if (!s) {
          pl.light.intensity = 0;
          continue;
        }
        let f = 1;
        if (s.flicker > 0) f = 1 - s.flicker * (0.5 + 0.5 * Math.sin(time * 17 + s.phase) * Math.sin(time * 5.3 + s.phase * 2));
        pl.light.intensity = s.intensity * pl.level * f;
      }
      // Chamas
      for (const fl of flames) {
        fl.sprites.forEach((sp, i) => {
          const t = time * (5 + i * 1.7) + fl.seed + i * 2;
          const h = 0.9 + 0.35 * Math.sin(t) + 0.15 * Math.sin(t * 2.7);
          sp.scale.set(0.55 - i * 0.1, h * (0.9 - i * 0.15), 1);
          sp.position.set(fl.base.x + Math.sin(t * 1.3) * 0.05 * (i + 1), fl.base.y + h * 0.28, fl.base.z + Math.cos(t * 1.1) * 0.05 * (i + 1));
          sp.material.opacity = 0.75 - i * 0.15;
        });
      }
    },
  };
}
