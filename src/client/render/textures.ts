import * as THREE from "three";

// ===== Texturas procedurais (canvas) — sem assets externos =====
// Cada função devolve uma CanvasTexture repetível. Tamanho menor no mobile.

export const IS_MOBILE =
  typeof matchMedia !== "undefined" && (matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);

const SIZE = IS_MOBILE ? 128 : 256;

type Ctx = CanvasRenderingContext2D;

// Ruído determinístico barato (LCG) para o resultado ser estável entre frames/recargas
let seed = 1;
function rnd(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}

function canvas(size = SIZE): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return [c, c.getContext("2d")!];
}

function finish(c: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = IS_MOBILE ? 1 : 4;
  return t;
}

function grain(ctx: Ctx, size: number, count: number, alpha: number, dark = true) {
  for (let i = 0; i < count; i++) {
    const v = Math.floor(rnd() * 255);
    ctx.fillStyle = dark ? `rgba(0,0,0,${alpha * rnd()})` : `rgba(${v},${v},${v},${alpha * rnd()})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
  }
}

function streaks(ctx: Ctx, size: number, count: number, color: string) {
  ctx.strokeStyle = color;
  for (let i = 0; i < count; i++) {
    const x = rnd() * size;
    ctx.lineWidth = 1 + rnd() * 3;
    ctx.beginPath();
    ctx.moveTo(x, rnd() * size * 0.3);
    ctx.lineTo(x + (rnd() - 0.5) * 6, size);
    ctx.stroke();
  }
}

export function sandTexture(): THREE.CanvasTexture {
  seed = 11;
  const [c, ctx] = canvas();
  const s = c.width;
  ctx.fillStyle = "#c8a066";
  ctx.fillRect(0, 0, s, s);
  // Manchas de terra mais escura
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = `rgba(120,85,45,${0.08 + rnd() * 0.12})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * s, rnd() * s, 8 + rnd() * 30, 6 + rnd() * 20, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  grain(ctx, s, s * 6, 0.25);
  grain(ctx, s, s * 2, 0.18, false);
  // Rachaduras
  ctx.strokeStyle = "rgba(70,45,20,0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    let x = rnd() * s, y = rnd() * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (rnd() - 0.5) * 24;
      y += (rnd() - 0.5) * 24;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return finish(c);
}

export function sandstoneTexture(): THREE.CanvasTexture {
  seed = 23;
  const [c, ctx] = canvas();
  const s = c.width;
  ctx.fillStyle = "#cdb287";
  ctx.fillRect(0, 0, s, s);
  // Blocos de pedra com juntas
  const bh = s / 4;
  const bw = s / 2;
  for (let row = 0; row < 4; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 3; col++) {
      const x = col * bw + off;
      const y = row * bh;
      const tone = 190 + Math.floor(rnd() * 30);
      ctx.fillStyle = `rgb(${tone},${tone - 30},${tone - 65})`;
      ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.fillRect(x + 2, y + bh - 5, bw - 4, 3);
    }
  }
  ctx.fillStyle = "rgba(80,60,35,0.55)";
  for (let row = 0; row <= 4; row++) ctx.fillRect(0, row * bh - 1, s, 2);
  grain(ctx, s, s * 5, 0.2);
  grain(ctx, s, s * 2, 0.15, false);
  streaks(ctx, s, 10, "rgba(60,45,30,0.18)");
  return finish(c);
}

export function plankTexture(): THREE.CanvasTexture {
  seed = 37;
  const [c, ctx] = canvas();
  const s = c.width;
  ctx.fillStyle = "#8a6238";
  ctx.fillRect(0, 0, s, s);
  const n = 5;
  const ph = s / n;
  for (let i = 0; i < n; i++) {
    const tone = 120 + Math.floor(rnd() * 40);
    ctx.fillStyle = `rgb(${tone},${tone - 45},${tone - 85})`;
    ctx.fillRect(0, i * ph + 1, s, ph - 2);
    // Veios
    ctx.strokeStyle = "rgba(60,35,15,0.35)";
    for (let k = 0; k < 6; k++) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      const y = i * ph + rnd() * ph;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + (rnd() - 0.5) * 6, s * 0.7, y + (rnd() - 0.5) * 6, s, y);
      ctx.stroke();
    }
    // Pregos
    ctx.fillStyle = "#3a3a3a";
    ctx.fillRect(6, i * ph + ph / 2 - 1, 3, 3);
    ctx.fillRect(s - 9, i * ph + ph / 2 - 1, 3, 3);
  }
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  for (let i = 0; i <= n; i++) ctx.fillRect(0, i * ph - 1, s, 2);
  // Moldura da caixa
  ctx.strokeStyle = "rgba(40,25,10,0.6)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, s - 6, s - 6);
  grain(ctx, s, s * 3, 0.2);
  return finish(c);
}

export function rustTexture(): THREE.CanvasTexture {
  seed = 41;
  const [c, ctx] = canvas();
  const s = c.width;
  ctx.fillStyle = "#5a3a22";
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 50; i++) {
    ctx.fillStyle = `rgba(${120 + rnd() * 80},${50 + rnd() * 40},${20 + rnd() * 20},${0.3 + rnd() * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * s, rnd() * s, 4 + rnd() * 20, 4 + rnd() * 12, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Anéis do barril
  ctx.fillStyle = "#2b2b2b";
  for (const y of [s * 0.18, s * 0.5, s * 0.82]) ctx.fillRect(0, y - 4, s, 8);
  grain(ctx, s, s * 4, 0.3);
  streaks(ctx, s, 8, "rgba(30,15,5,0.3)");
  return finish(c);
}

export function concreteTexture(): THREE.CanvasTexture {
  seed = 53;
  const [c, ctx] = canvas();
  const s = c.width;
  ctx.fillStyle = "#9a9384";
  ctx.fillRect(0, 0, s, s);
  grain(ctx, s, s * 6, 0.22);
  grain(ctx, s, s * 3, 0.2, false);
  streaks(ctx, s, 12, "rgba(40,40,40,0.15)");
  return finish(c);
}

export function camoTexture(base = "#8a7a55"): THREE.CanvasTexture {
  seed = 61;
  const [c, ctx] = canvas(IS_MOBILE ? 64 : 128);
  const s = c.width;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  const tones = ["#6b5d3f", "#a4956c", "#4f4630", "#7d6c48"];
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = tones[i % tones.length];
    ctx.beginPath();
    ctx.ellipse(rnd() * s, rnd() * s, 4 + rnd() * 12, 3 + rnd() * 8, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  grain(ctx, s, s * 2, 0.15);
  return finish(c);
}

export function kevlarTexture(): THREE.CanvasTexture {
  seed = 71;
  const [c, ctx] = canvas(IS_MOBILE ? 64 : 128);
  const s = c.width;
  ctx.fillStyle = "#2c3034";
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let y = 0; y < s; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < s; x += 4) ctx.fillRect(x, y, 2, 2);
  grain(ctx, s, s, 0.2);
  return finish(c);
}

export function rottenSkinTexture(hex: number): THREE.CanvasTexture {
  seed = 83 + (hex & 0xff);
  const [c, ctx] = canvas(IS_MOBILE ? 64 : 128);
  const s = c.width;
  const col = new THREE.Color(hex);
  ctx.fillStyle = `rgb(${col.r * 255},${col.g * 255},${col.b * 255})`;
  ctx.fillRect(0, 0, s, s);
  // Manchas de necrose
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(40,30,25,${0.2 + rnd() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * s, rnd() * s, 3 + rnd() * 10, 2 + rnd() * 8, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Veias
  ctx.strokeStyle = "rgba(90,20,30,0.6)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    let x = rnd() * s, y = rnd() * s;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      x += (rnd() - 0.5) * 18;
      y += (rnd() - 0.5) * 18;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Feridas abertas
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = "rgba(140,10,20,0.85)";
    ctx.beginPath();
    ctx.ellipse(rnd() * s, rnd() * s, 3 + rnd() * 5, 2 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  grain(ctx, s, s * 2, 0.25);
  return finish(c);
}

export function bloodSplatTexture(): THREE.CanvasTexture {
  seed = 97;
  const [c, ctx] = canvas(128);
  const s = c.width;
  ctx.clearRect(0, 0, s, s);
  for (let i = 0; i < 22; i++) {
    const r = i === 0 ? 30 : 3 + rnd() * 12;
    const a = rnd() * Math.PI * 2;
    const d = i === 0 ? 0 : 10 + rnd() * 40;
    ctx.fillStyle = `rgba(${90 + rnd() * 40},${5 + rnd() * 10},${8 + rnd() * 10},${0.7 + rnd() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, r, r * (0.6 + rnd() * 0.4), a, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function bulletHoleTexture(): THREE.CanvasTexture {
  seed = 101;
  const [c, ctx] = canvas(64);
  const s = c.width;
  ctx.clearRect(0, 0, s, s);
  const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(10,8,6,1)");
  g.addColorStop(0.35, "rgba(30,25,20,0.9)");
  g.addColorStop(0.7, "rgba(60,50,40,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = "rgba(20,15,10,0.6)";
    ctx.beginPath();
    ctx.moveTo(s / 2, s / 2);
    const a = rnd() * Math.PI * 2;
    ctx.lineTo(s / 2 + Math.cos(a) * (12 + rnd() * 16), s / 2 + Math.sin(a) * (12 + rnd() * 16));
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function smokeTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64);
  const s = c.width;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.5, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

// Cache: cada textura é gerada uma vez por página
const cache = new Map<string, THREE.CanvasTexture>();
export function tex(name: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = cache.get(name);
  if (!t) {
    t = make();
    cache.set(name, t);
  }
  return t;
}
