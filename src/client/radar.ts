import { MAP } from "../shared/map";
import { predictedPos } from "./predictedPos";
import { state } from "./state";

// ===== Radar (minimapa) + bússola =====
// O mapa estático é desenhado uma vez num canvas fora da tela; a cada frame só gira/recorta ao redor do jogador.

const PX_PER_M = 3;
const RADAR_RANGE_M = 30; // raio visível
const ENEMY_PING_M = 16; // inimigos só aparecem perto (como num radar de proximidade)

let mapCanvas: HTMLCanvasElement | null = null;
const halfX = MAP.size.x;
const halfZ = MAP.size.z;

function buildMapLayer(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.ceil(halfX * 2 * PX_PER_M);
  c.height = Math.ceil(halfZ * 2 * PX_PER_M);
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(60, 54, 42, 0.85)"; // chão
  g.fillRect(0, 0, c.width, c.height);
  for (const b of MAP.boxes) {
    const x = (b.min.x + halfX) * PX_PER_M;
    const y = (b.min.z + halfZ) * PX_PER_M;
    const w = (b.max.x - b.min.x) * PX_PER_M;
    const h = (b.max.z - b.min.z) * PX_PER_M;
    switch (b.kind) {
      case "wall":
        g.fillStyle = "#cfc6b0";
        break;
      case "arch":
      case "roof":
        g.fillStyle = "rgba(150, 140, 120, 0.55)";
        break;
      case "platform":
      case "step":
        g.fillStyle = "#8a7e68";
        break;
      default:
        g.fillStyle = "#a89a7c"; // caixas, barris, pilares
    }
    g.fillRect(x, y, w, h);
  }
  return c;
}

const dot = (g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, ring = false) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  if (ring) {
    g.lineWidth = 1.5;
    g.strokeStyle = "rgba(0,0,0,0.7)";
    g.stroke();
  }
};

let radar: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

export function updateRadar(yaw: number) {
  const me = state.me;
  if (!me) return;
  radar ??= document.getElementById("radar") as HTMLCanvasElement | null;
  if (!radar) return;
  ctx ??= radar.getContext("2d");
  if (!ctx) return;
  mapCanvas ??= buildMapLayer();
  const g = ctx;
  const size = radar.width;
  const scale = size / 2 / (RADAR_RANGE_M * PX_PER_M); // px do canvas por px do mapa
  const pos = predictedPos() ?? me.pos;

  g.clearRect(0, 0, size, size);
  g.save();
  g.translate(size / 2, size / 2);
  g.rotate(yaw); // frente do jogador sempre para cima
  g.scale(scale, scale);
  g.translate(-(pos.x + halfX) * PX_PER_M, -(pos.z + halfZ) * PX_PER_M);
  g.drawImage(mapCanvas, 0, 0);

  const snap = state.snapshot;
  if (snap) {
    for (const p of snap.players) {
      if (!p.alive || p.id === state.id) continue;
      const allied = p.team === me.team;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (!allied && (d > ENEMY_PING_M || p.invisible)) continue;
      const px = (p.pos.x + halfX) * PX_PER_M;
      const py = (p.pos.z + halfZ) * PX_PER_M;
      const r = 5 / scale / 1.6;
      dot(g, px, py, r, allied ? "#4aa8ff" : p.isBoss ? "#ff1744" : "#7cff6b", true);
      if (allied) {
        // Indicador de direção do aliado
        g.save();
        g.translate(px, py);
        g.rotate(-p.yaw);
        g.beginPath();
        g.moveTo(0, -r * 2.1);
        g.lineTo(r * 0.8, -r * 0.9);
        g.lineTo(-r * 0.8, -r * 0.9);
        g.closePath();
        g.fillStyle = "#4aa8ff";
        g.fill();
        g.restore();
      }
    }
  }
  g.restore();
  // Borda circular suave
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.36, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.7)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
}

// ----- Bússola -----

const CARD: Record<number, string> = { 0: "N", 45: "NE", 90: "L", 135: "SE", 180: "S", 225: "SO", 270: "O", 315: "NO" };
const PX_PER_DEG = 4;
let strip: HTMLElement | null = null;

function buildCompass(el: HTMLElement) {
  // 3 voltas (−360..720) para o deslocamento nunca sair da faixa desenhada
  let html = "";
  for (let deg = -360; deg < 720; deg += 15) {
    const d = ((deg % 360) + 360) % 360;
    const label = CARD[d] ?? (d % 30 === 0 ? String(d) : "·");
    html += `<span class="${CARD[d] ? "card" : ""}" style="left:${(deg + 360) * PX_PER_DEG}px">${label}</span>`;
  }
  el.style.width = `${1080 * PX_PER_DEG + 40}px`;
  el.innerHTML = html;
}

/** yaw (rad, 0 = norte/-z, cresce para a esquerda) → graus de bússola. */
export function updateCompass(yaw: number) {
  strip ??= document.getElementById("compass-strip");
  if (!strip) return;
  if (!strip.firstChild) buildCompass(strip);
  const heading = (((-yaw * 180) / Math.PI) % 360 + 360) % 360; // 0..360, horário
  const wrap = strip.parentElement!.clientWidth || 300;
  strip.style.transform = `translateX(${wrap / 2 - (heading + 360) * PX_PER_DEG}px)`;
}
