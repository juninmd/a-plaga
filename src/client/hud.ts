import { audio } from "./audio";
import { lockPointer, unlockPointer } from "./input";
import { net } from "./net";
import { estimatedSpread, findPlayer, state, weaponName } from "./state";
import { WEAPONS } from "../shared/weapons";

// ===== HUD estilo CS 1.6 =====

const $ = (id: string) => document.getElementById(id)!;

// Escrever no DOM a 20 Hz força layout mesmo sem mudança — só escreve quando o valor muda
const textCache = new Map<string, string>();
function setText(id: string, value: string) {
  if (textCache.get(id) === value) return;
  textCache.set(id, value);
  $(id).textContent = value;
}
function setClass(id: string, cls: string, on: boolean) {
  const key = `${id}.${cls}`;
  const v = on ? "1" : "0";
  if (textCache.get(key) === v) return;
  textCache.set(key, v);
  $(id).classList.toggle(cls, on);
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ----- Vitals / arma / dinheiro -----

let lastWeaponShown = "";
export function updateHUD() {
  const me = state.me;
  if (!me) return;
  setText("hp-text", String(Math.max(0, Math.round(state.hp))));
  setClass("hp-box", "low", state.hp / me.maxHp < 0.3);
  setText("armor-text", String(Math.round(state.armor)));
  setClass("armor-box", "dim", state.armor <= 0);
  setText("ap-text", `$ ${state.ap}`);

  const w = WEAPONS[state.weapon];
  const melee = !w || w.slot === 3;
  setText("weapon-name", state.team === "zombie" ? "GARRAS" : (w?.name ?? state.weapon).toUpperCase());
  setText("ammo-cur", melee ? "—" : me.reloading ? "···" : String(state.ammo));
  setText("ammo-res", melee ? "" : String(state.reserve));
  setClass("ammo-box", "empty", !melee && state.ammo === 0 && !me.reloading);
  setClass("ammo-box", "reloading", me.reloading);
  const slotsKey = `${state.slots.join(",")}|${state.weapon}`;
  if (textCache.get("slots-key") !== slotsKey) {
    textCache.set("slots-key", slotsKey);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("#slots .slot"))) {
      const slot = Number(el.dataset.slot);
      const id = state.slots[slot - 1];
      el.classList.toggle("has", !!id);
      el.classList.toggle("active", !!id && id === state.weapon);
      el.title = id ? weaponName(id) : "";
    }
  }
  setClass("slots", "hidden", state.team === "zombie");
  if (lastWeaponShown !== state.weapon) lastWeaponShown = state.weapon;

  const abilityKey = "E";
  setText("ability-info", state.abilityReady ? `${abilityKey} · habilidade pronta` : `${abilityKey} · recarregando`);
  setClass("ability-info", "ready", state.abilityReady);

  // Vinheta vermelha quando HP baixo (quantizada para não reescrever o estilo a cada tick)
  const hpPct = state.hp / me.maxHp;
  const vig =
    hpPct < 0.35
      ? `inset 0 0 ${Math.round((1 - hpPct / 0.35) * 180 + 80)}px rgba(198,40,40,${((0.35 - hpPct) * 1.5).toFixed(2)})`
      : "inset 0 0 160px rgba(0,0,0,0.75)";
  if (textCache.get("vignette") !== vig) {
    textCache.set("vignette", vig);
    $("vignette").style.boxShadow = vig;
  }

  updateDeadOverlay(me.alive);
  updateSpawnHint();
}

// ----- Mira dinâmica -----

export function updateCrosshair(moving: boolean, airborne: boolean, crouching: boolean) {
  const spread = estimatedSpread(moving, airborne, crouching);
  // rad → px: distância focal aproximada da câmera em pixels
  const focal = window.innerHeight / (2 * Math.tan((75 / 2) * (Math.PI / 180)));
  const gap = Math.min(80, 3 + spread * focal * 2.2);
  const gapText = `${gap.toFixed(1)}px`;
  if (textCache.get("crosshair-gap") !== gapText) {
    textCache.set("crosshair-gap", gapText);
    $("crosshair").style.setProperty("--gap", gapText);
  }
  setClass("crosshair", "hidden", state.ui.zooming || !state.me?.alive);
  setClass("scope", "hidden", !state.ui.zooming || !state.me?.alive);
}

let hitTimer = 0;
export function hitmarker(kill = false) {
  const el = $("hitmarker");
  el.classList.remove("on", "kill");
  void el.offsetWidth; // reinicia a animação
  el.classList.add("on");
  if (kill) el.classList.add("kill");
  clearTimeout(hitTimer);
  hitTimer = window.setTimeout(() => el.classList.remove("on", "kill"), 180);
}

let hurtTimer = 0;
export function flashHurt() {
  const el = $("hurt");
  el.classList.add("on");
  clearTimeout(hurtTimer);
  hurtTimer = window.setTimeout(() => el.classList.remove("on"), 90);
}

/** Arco vermelho apontando de onde veio o dano. */
let dirTimer = 0;
export function damageDirection(srcId: number | undefined, yaw: number) {
  const src = findPlayer(srcId);
  const me = state.me;
  if (!src || !me) return;
  const ang = Math.atan2(-(src.pos.x - me.pos.x), -(src.pos.z - me.pos.z)); // mesmo referencial do yaw
  const rel = ang - yaw;
  const el = $("dmg-dir");
  el.style.transform = `translate(-50%, -50%) rotate(${-rel}rad)`;
  el.classList.add("on");
  clearTimeout(dirTimer);
  dirTimer = window.setTimeout(() => el.classList.remove("on"), 600);
}

// ----- Round / banners -----

let lastPhase = "";
let lastBeat = -1;
export function updateRoundInfo() {
  const r = state.roundInfo;
  if (!r) return;
  const time = Math.max(0, Math.ceil(r.timeLeft));
  const mm = String(Math.floor(time / 60)).padStart(2, "0");
  const ss = String(time % 60).padStart(2, "0");
  $("round-time").textContent = `${mm}:${ss}`;
  $("round-time").classList.toggle("urgent", r.phase !== "countdown" && time <= 20);
  $("round-mode").textContent = `${r.modeLabel} · R${r.number}`;
  $("round-teams").textContent = `🧟 ${r.zombies}  vs  🧍 ${r.humans}`;
  const center = $("hud-center");
  if (r.phase === "countdown") {
    center.innerHTML = `<div class="big">${Math.ceil(r.timeLeft)}</div><div class="mode">${esc(r.modeLabel)}</div>`;
  } else if (r.phase === "last_human") {
    if (lastPhase !== "last_human") center.innerHTML = `<div class="big red">ÚLTIMO HUMANO</div>`;
    const beat = Math.floor(r.timeLeft);
    if (beat !== lastBeat) {
      lastBeat = beat;
      audio.heartbeat();
    }
  } else if (lastPhase !== r.phase) {
    center.innerHTML = "";
  }
  lastPhase = r.phase;
}

let streakTimer = 0;
export function showStreak(label: string) {
  const el = $("streak-banner");
  el.textContent = label;
  el.classList.remove("hidden");
  clearTimeout(streakTimer);
  streakTimer = window.setTimeout(() => el.classList.add("hidden"), 2500);
}

export function showCenter(html: string, ms = 2500) {
  const c = $("hud-center");
  c.innerHTML = html;
  window.setTimeout(() => {
    if (c.innerHTML === html) c.innerHTML = "";
  }, ms);
}

function updateSpawnHint() {
  const r = state.roundInfo;
  const me = state.me;
  const show = !!me && me.alive && me.team === "human" && !!r && (r.phase === "countdown" || performance.now() - spawnedAt < 5000);
  $("spawn-hint").classList.toggle("hidden", !show || state.ui.shopOpen);
}
let spawnedAt = -1e9;
export function markSpawned() {
  spawnedAt = performance.now();
}

// ----- Morte -----

function updateDeadOverlay(alive: boolean) {
  const el = $("dead");
  el.classList.toggle("hidden", alive);
  if (alive) return;
  const left = Math.max(0, 5 - (performance.now() - state.diedAt) / 1000);
  $("dead-timer").textContent = String(Math.ceil(left));
  $("dead-infected").classList.toggle("hidden", state.team !== "zombie");
  const d = state.deathInfo;
  $("dead-reason").textContent = d ? `${d.killer} te pegou com ${d.weapon}${d.headshot ? " (na cabeça)" : ""}.` : "";
}

// ----- Killfeed / chat -----

export function addKillfeed(killer: string, victim: string, weapon: string, headshot: boolean, streak?: string) {
  const el = document.createElement("div");
  el.className = "kill";
  const mine = state.me && (killer === state.me.name || victim === state.me.name);
  if (mine) el.classList.add("mine");
  const head = headshot ? " 🎯" : "";
  const st = streak ? ` <span class="streak">${esc(streak)}</span>` : "";
  el.innerHTML = `<b>${esc(killer)}</b> <span class="w">[${esc(weapon)}]</span>${head} <b>${esc(victim)}</b>${st}`;
  $("killfeed").appendChild(el);
  while ($("killfeed").children.length > 6) $("killfeed").removeChild($("killfeed").firstChild!);
  window.setTimeout(() => el.remove(), 6000);
}

export function addChat(name: string, text: string, system = false, color?: number) {
  const el = document.createElement("div");
  el.className = "line" + (system ? " system" : "");
  const c = color != null ? `style="color:#${color.toString(16).padStart(6, "0")}"` : "";
  el.innerHTML = `<b ${c}>${esc(name)}</b>: ${esc(text)}`;
  const log = $("chat-log");
  log.appendChild(el);
  while (log.children.length > 8) log.removeChild(log.firstChild!);
  window.setTimeout(() => el.classList.add("fade"), 9000);
}

export function setChat(open: boolean) {
  state.ui.chatOpen = open;
  $("chat-box").classList.toggle("active", open);
  const input = $("chat-input") as HTMLInputElement;
  if (open) {
    input.focus();
    unlockPointer();
  } else {
    input.blur();
    lockPointer();
  }
}

export function submitChat() {
  const input = $("chat-input") as HTMLInputElement;
  if (input.value.trim()) net.send({ t: "chat", d: { text: input.value } });
  input.value = "";
  setChat(false);
}

// ----- Placar -----

export function toggleScore(open?: boolean) {
  const next = open ?? !state.ui.scoreOpen;
  if (next === state.ui.scoreOpen) return;
  state.ui.scoreOpen = next;
  $("scoreboard").classList.toggle("hidden", !next);
  if (next) renderScore();
}

export function renderScore() {
  const snap = state.snapshot;
  if (!snap) return;
  const rows = [...snap.players].sort((a, b) => b.kills - a.kills || b.infections - a.infections);
  const tbody = $("score-table").querySelector("tbody")!;
  tbody.innerHTML = "";
  for (const p of rows) {
    const tr = document.createElement("tr");
    if (p.id === state.id) tr.className = "me";
    if (!p.alive) tr.classList.add("dead");
    const side = p.team === "zombie" ? "🧟 Zumbi" : "🧍 Humano";
    tr.innerHTML = `
      <td>${esc(p.name)}${p.isBoss ? " ★" : ""}</td>
      <td class="${p.team}">${side}</td>
      <td>${p.kills}</td>
      <td>${p.infections}</td>
      <td>${p.deaths}</td>`;
    tbody.appendChild(tr);
  }
  const r = state.roundInfo;
  $("score-title").textContent = r ? `PLACAR · ${r.modeLabel} · ROUND ${r.number}` : "PLACAR";
}

export function setNetStatus(connected: boolean) {
  $("net-status").classList.toggle("hidden", connected);
}
