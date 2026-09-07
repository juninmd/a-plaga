import { net } from "./net";
import { menuOpen, state } from "./state";
import type { InputState, WeaponSlot } from "../shared/protocol";

// ===== Entrada (desktop). O touch.ts alimenta o objeto `touch` no celular. =====

export const keys = new Set<string>();
export const mouseDown = new Set<number>();
export const look = { yaw: 0, pitch: 0, initialized: false };

export const touch = {
  moveX: 0,
  moveY: 0,
  attack: false,
  jump: false,
  ability: false,
  crouch: false,
  zoom: false,
};

export interface InputHandlers {
  toggleShop(): void;
  toggleScore(open?: boolean): void;
  openChat(): void;
  submitChat(): void;
  closeMenus(): void;
  onShopDigit(d: number): boolean; // true = consumido pelo menu de compra
  onSwitch(slot: WeaponSlot): void;
  onReload(): void;
  /** Clique de tiro: feedback local imediato (predição). */
  onFire?(): void;
}

let canvas: HTMLElement | null = null;
let isMobile = false;

function clamp1(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

export function isMoving(): boolean {
  return Math.abs(touch.moveX) + Math.abs(touch.moveY) > 0.1 || ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].some((k) => keys.has(k));
}

export function isCrouching(): boolean {
  return touch.crouch || (!menuOpen() && (keys.has("control") || keys.has("c")));
}

export function buildInput(): InputState {
  const kb = !menuOpen();
  const kbX = kb ? (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0) : 0;
  const kbY = kb ? (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0) : 0;
  return {
    moveX: clamp1(kbX + touch.moveX),
    moveY: clamp1(kbY + touch.moveY),
    jump: (kb && keys.has(" ")) || touch.jump,
    crouch: isCrouching(),
    attack: (kb && mouseDown.has(0)) || touch.attack,
    ability: (kb && keys.has("e")) || touch.ability,
    yaw: look.yaw,
    pitch: look.pitch,
    zoom: (kb && mouseDown.has(2)) || touch.zoom,
  };
}

export function sendInput() {
  if (state.id < 0 || !look.initialized) return;
  const input = buildInput();
  state.ui.zooming = input.zoom;
  net.send({ t: "input", d: input });
}

export function lockPointer() {
  if (!isMobile && canvas && !document.pointerLockElement) {
    canvas.requestPointerLock?.();
  }
}

export function unlockPointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

export function addLook(dx: number, dy: number) {
  look.yaw -= dx;
  look.pitch -= dy;
  look.pitch = Math.max(-1.45, Math.min(1.45, look.pitch));
}

export function setupInput(el: HTMLElement, mobile: boolean, h: InputHandlers) {
  canvas = el;
  isMobile = mobile;

  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (e.key === "Enter") {
      if (state.ui.chatOpen) h.submitChat();
      else if (!state.ui.shopOpen) h.openChat();
      return;
    }
    if (e.key === "Escape") {
      h.closeMenus();
      return;
    }
    if (state.ui.chatOpen) return; // digitando — não captura teclas de jogo
    if (k === "tab") {
      e.preventDefault();
      h.toggleScore(true);
      return;
    }
    if (state.ui.shopOpen) {
      if (k >= "0" && k <= "9" && h.onShopDigit(Number(k))) return;
      if (k === "b") h.toggleShop();
      return;
    }
    if (e.repeat) return;
    keys.add(k);
    if (k === "control") e.preventDefault();
    if (k === "b") h.toggleShop();
    else if (k === "r") h.onReload();
    else if (k === "1" || k === "2" || k === "3") h.onSwitch(Number(k) as WeaponSlot);
    else if (k === "e") {
      // Habilidade é por borda: manda já e de novo logo depois para não perder o tick
      sendInput();
      setTimeout(sendInput, 50);
    }
    sendInput();
  });

  document.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (k === "tab") h.toggleScore(false);
    sendInput();
  });

  // Teclas presas ao trocar de janela
  window.addEventListener("blur", () => {
    keys.clear();
    mouseDown.clear();
    sendInput();
  });

  document.addEventListener("contextmenu", (e) => e.preventDefault());

  document.addEventListener("mousemove", (e) => {
    if (menuOpen() || !document.pointerLockElement) return;
    const sens = state.ui.zooming ? 0.0009 : 0.0022;
    addLook(e.movementX * sens, e.movementY * sens);
    sendInput();
  });

  document.addEventListener("mousedown", (e) => {
    if (isMobile || menuOpen()) return;
    if (!document.pointerLockElement) {
      lockPointer();
      return;
    }
    mouseDown.add(e.button);
    if (e.button === 0) h.onFire?.();
    sendInput();
  });

  document.addEventListener("mouseup", (e) => {
    mouseDown.delete(e.button);
    sendInput();
  });

  document.addEventListener(
    "wheel",
    (e) => {
      if (isMobile || menuOpen() || state.team === "zombie") return;
      e.preventDefault();
      const cur = Math.max(1, (state.slots.findIndex((s) => s === state.weapon) + 1) as number);
      const dir = e.deltaY > 0 ? 1 : -1;
      let next = cur;
      for (let i = 0; i < 3; i++) {
        next = (((next - 1 + dir) % 3) + 3) % 3 + 1;
        if (state.slots[next - 1]) break;
      }
      h.onSwitch(next as WeaponSlot);
    },
    { passive: false },
  );

  document.addEventListener("pointerlockchange", () => {
    state.ui.pointerLocked = document.pointerLockElement != null;
  });
}
