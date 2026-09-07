import { addLook, sendInput, touch } from "./input";
import { state } from "./state";
import type { WeaponSlot } from "../shared/protocol";

// ===== Controles touch (celular) =====

export interface TouchHandlers {
  toggleShop(): void;
  toggleScore(): void;
  onSwitch(slot: WeaponSlot): void;
  onReload(): void;
}

const $ = (id: string) => document.getElementById(id)!;

export function setupTouch(h: TouchHandlers) {
  const stickZone = $("stick-zone");
  const stickBase = $("stick-base");
  const knob = $("stick-knob");
  const lookZone = $("look-zone");

  let stickTouch = -1;
  let stickCx = 0;
  let stickCy = 0;
  const STICK_R = 60;

  const setKnob = (dx: number, dy: number) => {
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };

  stickZone.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      if (stickTouch !== -1) return; // segundo dedo na zona não rouba o analógico do primeiro
      const t = e.changedTouches[0];
      stickTouch = t.identifier;
      // A base do analógico nasce onde o dedo tocou
      const zone = stickZone.getBoundingClientRect();
      stickCx = t.clientX;
      stickCy = t.clientY;
      stickBase.style.left = `${stickCx - zone.left - 70}px`;
      stickBase.style.top = `${stickCy - zone.top - 70}px`;
      stickBase.classList.add("active");
    },
    { passive: false },
  );

  stickZone.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== stickTouch) continue;
        let dx = t.clientX - stickCx;
        let dy = t.clientY - stickCy;
        const len = Math.hypot(dx, dy);
        if (len > STICK_R) {
          dx = (dx / len) * STICK_R;
          dy = (dy / len) * STICK_R;
        }
        setKnob(dx, dy);
        touch.moveX = dx / STICK_R;
        touch.moveY = -dy / STICK_R;
        sendInput();
      }
    },
    { passive: false },
  );

  const stickEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== stickTouch) continue;
      stickTouch = -1;
      touch.moveX = 0;
      touch.moveY = 0;
      setKnob(0, 0);
      stickBase.classList.remove("active");
      sendInput();
    }
  };
  stickZone.addEventListener("touchend", stickEnd);
  stickZone.addEventListener("touchcancel", stickEnd);

  // Mirar arrastando na zona direita (o botão de tiro também arrasta)
  const lookTouches = new Map<number, { x: number; y: number }>();
  const lookStart = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) lookTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
  };
  const lookMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const prev = lookTouches.get(t.identifier);
      if (!prev) continue;
      const sens = state.ui.zooming ? 0.002 : 0.0055;
      addLook((t.clientX - prev.x) * sens, (t.clientY - prev.y) * sens);
      lookTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
      sendInput();
    }
  };
  const lookEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) lookTouches.delete(t.identifier);
  };
  for (const el of [lookZone, $("btn-fire")]) {
    el.addEventListener("touchstart", lookStart, { passive: false });
    el.addEventListener("touchmove", lookMove, { passive: false });
    el.addEventListener("touchend", lookEnd);
    el.addEventListener("touchcancel", lookEnd);
  }

  // Botões de segurar
  const hold = (id: string, flag: "attack" | "jump" | "ability") => {
    const el = $(id);
    el.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        touch[flag] = true;
        el.classList.add("down");
        sendInput();
      },
      { passive: false },
    );
    const off = () => {
      touch[flag] = false;
      el.classList.remove("down");
      sendInput();
    };
    el.addEventListener("touchend", off);
    el.addEventListener("touchcancel", off);
  };
  hold("btn-fire", "attack");
  hold("btn-jump", "jump");
  hold("btn-ability", "ability");

  // Botões de toque único
  const tap = (id: string, fn: () => void) => {
    $(id).addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        fn();
      },
      { passive: false },
    );
  };
  tap("btn-crouch", () => {
    touch.crouch = !touch.crouch;
    $("btn-crouch").classList.toggle("down", touch.crouch);
    sendInput();
  });
  tap("btn-reload", () => h.onReload());
  tap("btn-switch", () => {
    if (state.team === "zombie") return;
    const cur = state.slots.findIndex((s) => s === state.weapon) + 1;
    let next = cur > 0 ? cur : 1;
    for (let i = 0; i < 3; i++) {
      next = (next % 3) + 1;
      if (state.slots[next - 1]) break;
    }
    h.onSwitch(next as WeaponSlot);
  });
  tap("btn-shop", () => h.toggleShop());
  tap("btn-score", () => h.toggleScore());
  tap("btn-zoom", () => {
    touch.zoom = !touch.zoom;
    $("btn-zoom").classList.toggle("down", touch.zoom);
    sendInput();
  });
}
