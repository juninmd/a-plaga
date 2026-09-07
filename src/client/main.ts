import * as THREE from "three";
import { audio } from "./audio";
import { handleFx } from "./fx";
import {
  addChat,
  addKillfeed,
  markSpawned,
  renderScore,
  setChat,
  setNetStatus,
  showCenter,
  showStreak,
  submitChat,
  toggleScore,
  updateCrosshair,
  updateHUD,
  updateRoundInfo,
} from "./hud";
import { isCrouching, isMoving, look, sendInput, setupInput, touch } from "./input";
import { net } from "./net";
import { createRenderer, IS_MOBILE, type Renderer } from "./render/renderer";
import { renderShop, shopDigit, toggleShop } from "./shop";
import { decayRecoil, state } from "./state";
import { setupTouch } from "./touch";
import type { PlayerState, ServerMsg, ServerSnapshot, WeaponSlot } from "../shared/protocol";
import { WEAPONS } from "../shared/weapons";

const $ = (id: string) => document.getElementById(id)!;
const renderer: Renderer = createRenderer();

// ===== Ações compartilhadas entre teclado e touch =====

function onSwitch(slot: WeaponSlot) {
  if (state.team === "zombie" || !state.slots[slot - 1] || state.slots[slot - 1] === state.weapon) return;
  net.send({ t: "switch", d: { slot } });
  renderer.viewmodelSwitch();
  audio.switchWeapon();
}

function onReload() {
  const w = WEAPONS[state.weapon];
  if (!w || w.slot === 3 || state.me?.reloading || state.ammo >= w.magazine || state.reserve <= 0) return;
  net.send({ t: "reload" });
}

function closeMenus() {
  if (state.ui.chatOpen) setChat(false);
  if (state.ui.shopOpen) toggleShop(false);
  if (state.ui.scoreOpen) toggleScore(false);
}

// ===== Entrada no jogo =====

function joinGame() {
  const name = ($("name-input") as HTMLInputElement).value.trim() || "Jogador";
  localStorage.setItem("a-plaga-name", name);
  audio.init();
  audio.resume();
  audio.wind();
  $("menu").classList.add("hidden");
  $("hud").classList.remove("hidden");
  if (IS_MOBILE) $("touch-ui").classList.remove("hidden");
  net.send({ t: "join", d: { name } });
  setupInput(renderer.renderer.domElement, IS_MOBILE, {
    toggleShop: () => toggleShop(),
    toggleScore,
    openChat: () => setChat(true),
    submitChat,
    closeMenus,
    onShopDigit: shopDigit,
    onSwitch,
    onReload,
  });
  if (IS_MOBILE) setupTouch({ toggleShop: () => toggleShop(), toggleScore: () => toggleScore(), onSwitch, onReload });
}

// ===== Rede =====

let wasAlive = true;
let lastSlotWeapon = "";
let lastReloading = false;

net.connect(
  (msg: ServerMsg) => {
    switch (msg.t) {
      case "welcome":
        state.id = msg.d.id;
        state.snapshot = msg.d.snapshot;
        renderer.localId = msg.d.id;
        audio.roundStart();
        break;
      case "snapshot":
        state.snapshot = msg.d;
        applySnapshot(msg.d);
        break;
      case "self":
        if (msg.d) {
          state.me = { ...(state.me ?? ({} as PlayerState)), ...msg.d } as PlayerState;
          state.team = msg.d.team ?? state.team;
          state.hp = msg.d.hp ?? state.hp;
          state.armor = msg.d.armor ?? state.armor;
          if (msg.d.slots) state.slots = msg.d.slots;
          if (msg.d.alive) markSpawned();
          if (state.ui.shopOpen) renderShop();
        }
        break;
      case "tick":
        state.hp = msg.d.hp;
        state.armor = msg.d.armor;
        state.ap = msg.d.ap;
        break;
      case "shop":
        state.ap = msg.d.ap;
        state.owned = new Set(msg.d.owned);
        if (state.ui.shopOpen) renderShop();
        break;
      case "event":
        handleFx(renderer, msg.d);
        break;
      case "kill": {
        addKillfeed(msg.d.killer, msg.d.victim, msg.d.weapon, msg.d.headshot, msg.d.streakLabel);
        const me = state.me?.name;
        if (msg.d.killer === me) {
          audio.kill();
          if (msg.d.streakLabel) showStreak(msg.d.streakLabel);
        }
        if (msg.d.victim === me) state.deathInfo = { killer: msg.d.killer, weapon: msg.d.weapon, headshot: msg.d.headshot };
        break;
      }
      case "chat":
        addChat(msg.d.name, msg.d.text, msg.d.system, msg.d.color);
        break;
      case "roundStart":
        state.roundInfo = msg.d;
        updateRoundInfo();
        if (msg.d.phase === "countdown") {
          audio.roundStart();
          markSpawned();
        }
        break;
      case "roundEnd":
        showCenter(
          `<div class="big ${msg.d.winner === "zombie" ? "green" : msg.d.winner === "human" ? "blue" : ""}">${
            msg.d.winner === "zombie" ? "A HORDA VENCEU" : msg.d.winner === "human" ? "HUMANOS VENCERAM" : "EMPATE"
          }</div><div class="mode">${msg.d.reason}</div>`,
          4500,
        );
        if (msg.d.winner === "human") audio.win();
        else if (msg.d.winner === "zombie") audio.lose();
        break;
      case "error":
        addChat("Sistema", msg.d, true, 0xff5252);
        break;
    }
  },
  (connected) => setNetStatus(connected || state.id < 0),
);

// ===== Snapshot =====

function applySnapshot(snap: ServerSnapshot) {
  state.roundInfo = snap.round;
  updateRoundInfo();
  for (const p of snap.players) {
    if (p.id === state.id) {
      if (!look.initialized) {
        look.yaw = p.yaw;
        look.pitch = p.pitch;
        look.initialized = true;
      }
      const prevTeam = state.team;
      state.me = p;
      state.team = p.team;
      state.hp = p.hp;
      state.armor = p.armor;
      state.weapon = p.weapon;
      state.ammo = p.ammo;
      state.reserve = p.reserve;
      state.abilityReady = p.abilityReady;
      if (p.slots) state.slots = p.slots;
      renderer.setViewmodel(p.weapon, p.team);
      if (p.reloading && !lastReloading) {
        renderer.viewmodelReload();
        audio.reload();
      }
      lastReloading = p.reloading;
      if (lastSlotWeapon && lastSlotWeapon !== p.weapon && p.team === "human") renderer.viewmodelSwitch();
      lastSlotWeapon = p.weapon;
      if (wasAlive && !p.alive) state.diedAt = performance.now();
      if (!wasAlive && p.alive) {
        markSpawned();
        state.deathInfo = null;
        touch.crouch = false;
      }
      wasAlive = p.alive;
      if (prevTeam !== p.team && state.ui.shopOpen) renderShop();
      // Zoom só faz sentido com arma que tem mira telescópica
      const w = WEAPONS[p.weapon];
      renderer.setZoom(state.ui.zooming && w?.zoom && p.alive ? w.zoom : null);
      if (!w?.zoom) state.ui.zooming = false;
    }
    renderer.upsertPlayer(p);
  }
  const ids = new Set(snap.players.map((p) => p.id));
  for (const id of renderer.playerIds()) if (!ids.has(id)) renderer.removePlayer(id);
  renderer.upsertPickups(snap.pickups);
  renderer.upsertProjectiles(snap.projectiles);
  renderer.localId = state.id;
  updateHUD();
  if (state.ui.scoreOpen) renderScore();
  ambientSounds(snap);
}

/** Passos e gemidos dos outros, atenuados pela distância. */
let ambientTick = 0;
function ambientSounds(snap: ServerSnapshot) {
  const me = state.me;
  if (!me) return;
  ambientTick++;
  for (const p of snap.players) {
    if (p.id === state.id || !p.alive) continue;
    const d = Math.hypot(p.pos.x - me.pos.x, p.pos.z - me.pos.z);
    if (d > 25) continue;
    const vol = 1 - d / 25;
    if (p.speed > 1.5 && ambientTick % Math.max(4, Math.round(10 - p.speed)) === 0) audio.otherFootstep(p.team === "zombie", vol * 0.5);
    if (p.team === "zombie" && Math.random() < 0.004) audio.groan(vol);
  }
}

// ===== Loop de render =====

let lastFrame = performance.now();
function frame() {
  const nowMs = performance.now();
  const dt = Math.min(0.1, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  decayRecoil(dt);
  const me = state.me;
  const crouching = isCrouching();
  const moving = isMoving();
  const speed = me?.speed ?? 0;
  const airborne = !!me && me.pos.y > 0.15;
  if (me) {
    const eye = (crouching ? 1.0 : 1.6) * me.scale;
    renderer.setLocalCamera(new THREE.Vector3(me.pos.x, me.pos.y + eye, me.pos.z), look.yaw, look.pitch);
    if (me.alive && speed > 1 && !airborne) audio.footstep(speed, me.team === "zombie", 0.8);
  }
  updateCrosshair(moving || speed > 1, airborne, crouching);
  renderer.frame({
    moving: moving && speed > 0.5,
    reloading: me?.reloading === true,
    alive: me?.alive !== false,
    crouching,
    speed,
  });
  if (me && !me.alive) updateHUD(); // contador de respawn
  requestAnimationFrame(frame);
}

// ===== Boot =====

$("join-btn").addEventListener("click", joinGame);
$("name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinGame();
});
if (IS_MOBILE) {
  $("tip-desktop").classList.add("hidden");
  $("tip-touch").classList.remove("hidden");
  document.body.classList.add("mobile");
}
const saved = localStorage.getItem("a-plaga-name");
if (saved) ($("name-input") as HTMLInputElement).value = saved;

// Input a 20Hz além dos envios por evento
setInterval(sendInput, 50);
requestAnimationFrame(frame);
