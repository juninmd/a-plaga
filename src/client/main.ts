import * as THREE from "three";
import { audio } from "./audio";
import { net } from "./net";
import { createRenderer, type Renderer } from "./renderer";
import { EXTRA_ITEMS, HUMAN_CLASSES, ZOMBIE_CLASSES, type ClassDef, type ItemDef } from "../shared/balance";
import type { FxEvent, InputState, PlayerState, RoundInfo, ServerMsg, ServerSnapshot, Team } from "../shared/protocol";

// ===== Estado local =====

interface LocalState {
  id: number;
  me: PlayerState | null;
  hp: number;
  armor: number;
  ap: number;
  ammo: number;
  reserve: number;
  weapon: string;
  abilityReady: boolean;
  team: Team;
  snapshot: ServerSnapshot | null;
  roundInfo: RoundInfo | null;
  lastShotFx: { from: THREE.Vector3; to: THREE.Vector3; color: number; at: number }[];
}

const state: LocalState = {
  id: -1,
  me: null,
  hp: 100,
  armor: 0,
  ap: 0,
  ammo: 0,
  reserve: 0,
  weapon: "rifle",
  abilityReady: true,
  team: "human",
  snapshot: null,
  roundInfo: null,
  lastShotFx: [],
};

// ===== Input =====

const keys = new Set<string>();
const mouseDown = new Set<number>();
let yaw = 0;
let pitch = 0;
let chatOpen = false;
let shopOpen = false;
let scoreOpen = false;
let pointerLocked = false;

function sendInput() {
  if (state.id < 0) return;
  const input: InputState = {
    moveX: (keys.has("d") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("a") || keys.has("ArrowLeft") ? 1 : 0),
    moveY: (keys.has("w") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("s") || keys.has("ArrowDown") ? 1 : 0),
    jump: keys.has(" "),
    attack: mouseDown.has(0),
    ability: keys.has("r"),
    yaw,
    pitch,
    zoom: mouseDown.has(2),
  };
  net.send({ t: "input", d: input });
}

// ===== Setup =====

const renderer: Renderer = createRenderer();
const $ = (id: string) => document.getElementById(id)!;

function joinGame() {
  const name = ($("name-input") as HTMLInputElement).value.trim() || "Jogador";
  audio.init();
  audio.resume();
  $("menu").classList.add("hidden");
  $("hud").classList.remove("hidden");
  net.send({ t: "join", d: { name } });
  setupListeners();
}

function setupListeners() {
  document.addEventListener("keydown", (e) => {
    keys.add(e.key.toLowerCase());
    if (e.key.toLowerCase() === "b") toggleShop();
    if (e.key.toLowerCase() === "tab") {
      e.preventDefault();
      toggleScore();
    }
    if (e.key === "Enter") {
      if (chatOpen) {
        const input = $("chat-input") as HTMLInputElement;
        if (input.value.trim()) net.send({ t: "chat", d: { text: input.value } });
        input.value = "";
        setChat(false);
        renderer.renderer.domElement.requestPointerLock();
      } else {
        setChat(true);
      }
    }
    if (!chatOpen && !shopOpen && e.key.toLowerCase() === "r") {
      sendInput();
      setTimeout(sendInput, 50);
    }
  });

  document.addEventListener("keyup", (e) => {
    keys.delete(e.key.toLowerCase());
    sendInput();
  });

  document.addEventListener("mousemove", (e) => {
    if (chatOpen || shopOpen) return;
    if (document.pointerLockElement) {
      yaw -= e.movementX * 0.0025;
      pitch -= e.movementY * 0.0025;
      pitch = Math.max(-1.3, Math.min(1.3, pitch));
      sendInput();
    }
  });

  document.addEventListener("mousedown", (e) => {
    mouseDown.add(e.button);
    if (!pointerLocked && !chatOpen && !shopOpen) {
      renderer.renderer.domElement.requestPointerLock();
      sendInput();
    }
  });

  document.addEventListener("mouseup", (e) => {
    mouseDown.delete(e.button);
    sendInput();
  });

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement != null;
    if (pointerLocked && $("dead").classList.contains("hidden")) {
      $("dead").classList.add("hidden");
    }
  });

  // Classes (1-3) e itens
  document.addEventListener("keydown", (e) => {
    if (chatOpen) return;
    const n = e.key;
    if (n >= "1" && n <= "3") {
      const classes = state.team === "human" ? HUMAN_CLASSES : ZOMBIE_CLASSES;
      const cls = classes[Number(n) - 1];
      if (cls) selectClass(cls.id);
    }
  });
}

// ===== Loja =====

function selectClass(classId: string) {
  net.send({ t: "selectClass", d: { classId } });
}

function renderShop() {
  const team = state.team;
  const classes = team === "human" ? HUMAN_CLASSES : ZOMBIE_CLASSES;
  const items = EXTRA_ITEMS.filter((i) => i.side === team || i.side === "both");
  renderClassGrid(classes);
  renderItemGrid(items);
  $("shop-ap").textContent = String(state.ap);
}

function renderClassGrid(classes: ClassDef[]) {
  const box = $("shop-classes");
  box.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "shop-grid";
  const h = document.createElement("h3");
  h.textContent = `CLASSES ${state.team === "human" ? "HUMANAS" : "ZUMBIS"}`;
  grid.appendChild(h);
  for (const c of classes) {
    const el = document.createElement("div");
    el.className = "shop-item" + (state.me?.classId === c.id ? " selected" : "");
    el.innerHTML = `<span class="name">${c.name}</span><div class="desc">${c.desc}<br/>HP ${c.hp} · Vel ${Math.round(c.speed * 100)}%</div>`;
    el.onclick = () => selectClass(c.id);
    grid.appendChild(el);
  }
  box.appendChild(grid);
}

function renderItemGrid(items: ItemDef[]) {
  const box = $("shop-items");
  box.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "shop-grid";
  const h = document.createElement("h3");
  h.textContent = "ITENS EXTRAS (AP)";
  grid.appendChild(h);
  for (const it of items) {
    const el = document.createElement("div");
    el.className = "shop-item";
    el.innerHTML = `<span class="name">${it.name}</span><span class="cost">${it.cost} AP</span><div class="desc">${it.desc}</div>`;
    el.onclick = () => net.send({ t: "buy", d: { itemId: it.id } });
    grid.appendChild(el);
  }
  box.appendChild(grid);
}

function toggleShop() {
  if (state.id < 0) return;
  shopOpen = !shopOpen;
  $("shop").classList.toggle("hidden", !shopOpen);
  if (shopOpen) {
    renderShop();
    document.exitPointerLock();
  } else {
    renderer.renderer.domElement.requestPointerLock();
  }
}

function toggleScore() {
  scoreOpen = !scoreOpen;
  $("scoreboard").classList.toggle("hidden", !scoreOpen);
  if (scoreOpen) {
    renderScore();
    document.exitPointerLock();
  }
}

function setChat(open: boolean) {
  chatOpen = open;
  $("chat-box").classList.toggle("active", open);
  if (open) {
    ($("chat-input") as HTMLInputElement).focus();
    document.exitPointerLock();
  }
}

function renderScore() {
  const snap = state.snapshot;
  if (!snap) return;
  const rows = [...snap.players].sort((a, b) => b.kills - a.kills);
  const tbody = $("score-table").querySelector("tbody")!;
  tbody.innerHTML = "";
  for (const p of rows) {
    const tr = document.createElement("tr");
    const side = p.team === "zombie" ? "🧟 Zumbi" : "🧍 Humano";
    tr.innerHTML = `
      <td>${esc(p.name)}${p.id === state.id ? " (você)" : ""}${p.isBoss ? " ★" : ""}</td>
      <td class="${p.team}">${side}</td>
      <td>${p.kills}</td>
      <td>${p.infections}</td>
      <td>${p.deaths}</td>`;
    tbody.appendChild(tr);
  }
}

// ===== Rede =====

net.connect((msg: ServerMsg) => {
  switch (msg.t) {
    case "welcome": {
      state.id = msg.d.id;
      state.snapshot = msg.d.snapshot;
      audio.roundStart();
      break;
    }
    case "snapshot": {
      state.snapshot = msg.d;
      applySnapshot(msg.d);
      break;
    }
    case "self": {
      if (msg.d) {
        const prevTeam = state.team;
        state.me = msg.d as PlayerState;
        state.team = msg.d.team ?? prevTeam;
        state.hp = msg.d.hp ?? state.hp;
        state.armor = msg.d.armor ?? state.armor;
      }
      break;
    }
    case "tick": {
      state.hp = msg.d.hp;
      state.armor = msg.d.armor;
      state.ap = msg.d.ap;
      break;
    }
    case "shop": {
      state.ap = msg.d.ap;
      if (shopOpen) $("shop-ap").textContent = String(state.ap);
      break;
    }
    case "event": {
      handleFx(msg.d);
      break;
    }
    case "kill": {
      addKillfeed(msg.d.killer, msg.d.victim, msg.d.weapon, msg.d.headshot, msg.d.streakLabel);
      if (msg.d.killer === state.me?.name || msg.d.victim === state.me?.name) audio.kill();
      break;
    }
    case "chat": {
      addChat(msg.d.name, msg.d.text, msg.d.system, msg.d.color);
      break;
    }
    case "roundStart": {
      state.roundInfo = msg.d;
      updateRoundInfo();
      audio.roundStart();
      break;
    }
    case "roundEnd": {
      if (msg.d.winner === "human") audio.win();
      else if (msg.d.winner === "zombie") audio.lose();
      break;
    }
    case "error": {
      addChat("Sistema", msg.d, true, 0xff5252);
      break;
    }
  }
});

// ===== Snapshot =====

function applySnapshot(snap: ServerSnapshot) {
  // Round info (timer ao vivo vem do snapshot)
  state.roundInfo = snap.round;
  updateRoundInfo();
  // Player self
  for (const p of snap.players) {
    if (p.id === state.id) {
      state.me = p;
      state.team = p.team;
      state.hp = p.hp;
      state.armor = p.armor;
      state.weapon = p.weapon;
      state.ammo = p.ammo;
      state.reserve = p.reserve;
      state.abilityReady = p.abilityReady;
    }
    renderer.upsertPlayer(p);
  }
  // Remove players que saíram
  const ids = new Set(snap.players.map((p) => p.id));
  for (const p of renderer.playerIds()) {
    if (!ids.has(p)) renderer.removePlayer(p);
  }
  renderer.upsertPickups(snap.pickups);
  renderer.upsertProjectiles(snap.projectiles);
  renderer.localId = state.id;
  updateHUD();
  updateRoundInfo();
}

function updateHUD() {
  if (!state.me) return;
  const pct = Math.max(0, (state.hp / state.me.maxHp) * 100);
  $("hp-fill").style.width = `${pct}%`;
  $("hp-text").textContent = `${state.hp}/${state.me.maxHp}`;
  $("armor-fill").style.width = `${Math.min(100, state.armor)}%`;
  $("ap-text").textContent = String(state.ap);
  $("weapon-info").textContent = weaponName(state.weapon) + ` · ${state.ammo}/${state.reserve}`;
  $("ability-info").textContent = state.abilityReady ? "R — habilidade pronta" : "R — recarregando";
  // Vignette vermelha quando HP baixo
  const v = $("vignette");
  const hpPct = state.hp / state.me.maxHp;
  v.style.boxShadow =
    hpPct < 0.35
      ? `inset 0 0 ${(1 - hpPct / 0.35) * 180 + 80}px rgba(198,40,40,${(0.35 - hpPct) * 1.5})`
      : "inset 0 0 200px rgba(0,0,0,0.9)";
  // Morto
  $("dead").classList.toggle("hidden", state.me.alive);
  if (state.me.team === "zombie" && state.me.alive) {
    // HUD de infecção — borda verde
  }
}

function updateRoundInfo() {
  const r = state.roundInfo;
  if (!r) return;
  const mode = r.modeLabel;
  const time = Math.max(0, Math.ceil(r.timeLeft));
  const mm = String(Math.floor(time / 60)).padStart(2, "0");
  const ss = String(time % 60).padStart(2, "0");
  $("round-info").innerHTML = `<span class="mode">${mode}</span> · <span class="time">${mm}:${ss}</span> · 🧟 ${r.zombies} vs 🧍 ${r.humans}`;
  if (r.phase === "countdown") {
    $("hud-center").innerHTML = `<div class="big">${Math.ceil(r.timeLeft)}</div><div>${mode}</div>`;
  } else if (r.phase === "last_human") {
    $("hud-center").innerHTML = `<div class="big" style="color:#ff1744">ÚLTIMO HUMANO</div>`;
    audio.heartbeat();
  } else {
    $("hud-center").innerHTML = "";
  }
}

function weaponName(w: string): string {
  return { rifle: "Fuzil M4", shotgun: "Escopeta XM", deagle: "Deagle", m249: "M249", knife: "Garra" }[w] ?? w;
}

// ===== Killfeed / Chat =====

function addKillfeed(killer: string, victim: string, weapon: string, headshot: boolean, streak?: string) {
  const el = document.createElement("div");
  el.className = "kill";
  const head = headshot ? " 🎯" : "";
  const st = streak ? ` <b style="color:#ffd54f">${streak}</b>` : "";
  el.innerHTML = `<b>${esc(killer)}</b> ☠ <b>${esc(victim)}</b> [${weapon}]${head}${st}`;
  $("killfeed").appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function addChat(name: string, text: string, system = false, color?: number) {
  const el = document.createElement("div");
  el.className = "line" + (system ? " system" : "");
  const c = color != null ? `style="color:#${color.toString(16).padStart(6, "0")}"` : "";
  el.innerHTML = `<b ${c}>${esc(name)}</b>: ${esc(text)}`;
  $("chat-log").appendChild(el);
  while ($("chat-log").children.length > 8) $("chat-log").removeChild($("chat-log").firstChild!);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ===== FX =====

function handleFx(fx: FxEvent) {
  const v = new THREE.Vector3(fx.pos.x, fx.pos.y, fx.pos.z);
  switch (fx.kind) {
    case "tracer": {
      const me = state.me;
      if (me) {
        const from = new THREE.Vector3(me.pos.x, me.pos.y + 1.6, me.pos.z);
        renderer.tracer(from, v, fx.color);
      }
      break;
    }
    case "explosion":
      renderer.explosion(v, fx.color, fx.value ?? 4);
      audio.explosion();
      break;
    case "infect":
      renderer.explosion(v, fx.color, 2);
      audio.infect();
      break;
    case "heal":
      audio.heal();
      break;
    case "frost":
      renderer.explosion(v, 0x4fc3f7, 4);
      audio.ability();
      break;
    case "acid":
      renderer.explosion(v, 0x9ccc65, 2);
      break;
    case "speed":
    case "leap":
    case "invisible":
      audio.ability();
      break;
    case "damage": {
      if (fx.value != null) renderer.damageNumber(v, fx.value, false);
      audio.hit();
      break;
    }
    case "pickup":
      audio.buy();
      break;
  }
}

// ===== Render loop =====

function frame() {
  const snap = state.snapshot;
  if (snap && state.me) {
    const me = state.me;
    const camPos = new THREE.Vector3(me.pos.x, me.pos.y + 1.6 * me.scale, me.pos.z);
    renderer.setLocalCamera(camPos, me.yaw, me.pitch);
    // Traça tracers dos tiros próprios (baseado nos eventos recentes já aplicados)
  }
  renderer.frame(() => {});
  requestAnimationFrame(frame);
}

// Boot
$("join-btn").addEventListener("click", joinGame);
$("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinGame();
});
$("shop-close").addEventListener("click", toggleShop);

// Input loop a 20Hz
setInterval(sendInput, 50);

// Auto-join com nome salvo
const saved = localStorage.getItem("a-plaga-name");
if (saved) ($("name-input") as HTMLInputElement).value = saved;
document.addEventListener("beforeunload", () => {
  const name = ($("name-input") as HTMLInputElement).value.trim();
  if (name) localStorage.setItem("a-plaga-name", name);
});

requestAnimationFrame(frame);
