import * as THREE from "three";
import { audio } from "./audio";
import { damageDirection, flashHurt, hitmarker } from "./hud";
import { look } from "./input";
import type { Renderer } from "./render/renderer";
import { findPlayer, registerShot, state } from "./state";
import type { FxEvent } from "../shared/protocol";
import { WEAPONS } from "../shared/weapons";

// ===== Efeitos vindos do servidor → renderer + áudio =====

const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);

/** Volume conforme a distância até o jogador local (0 = inaudível). */
function fxVolume(pos: { x: number; z: number }, reach = 45): number {
  const me = state.me;
  if (!me) return 0;
  const d = Math.hypot(pos.x - me.pos.x, pos.z - me.pos.z);
  return Math.max(0, 1 - d / reach);
}

export function handleFx(renderer: Renderer, fx: FxEvent) {
  const pos = v3(fx.pos);
  const mine = fx.src === state.id;
  const onMe = fx.dst === state.id;
  switch (fx.kind) {
    case "tracer": {
      const from = fx.from ? v3(fx.from) : state.me ? new THREE.Vector3(state.me.pos.x, state.me.pos.y + 1.5, state.me.pos.z) : null;
      const w = WEAPONS[fx.weapon ?? state.weapon];
      if (from) renderer.tracer(from, pos, fx.color);
      if (mine) {
        // O clique já deu o feedback (predição); o tracer que chega logo depois só confirma
        const predicted = performance.now() - state.predictedShotAt < 120;
        state.predictedShotAt = -1e9;
        if (!predicted) {
          renderer.viewmodelFire();
          registerShot();
          const r = w?.recoil ?? 0.7;
          renderer.punch(-r * 0.012, (Math.random() - 0.5) * r * 0.006);
          audio.shoot(w?.sound ?? "rifle", 1);
        }
      } else if (from) {
        audio.shoot(w?.sound ?? "rifle", fxVolume(from, w?.sound === "sniper" ? 120 : 60) * 0.7);
      }
      break;
    }
    case "impact":
      renderer.impact(pos, fx.normal ? v3(fx.normal) : new THREE.Vector3(0, 1, 0));
      audio.impact(fxVolume(fx.pos, 25) * 0.6);
      break;
    case "blood":
      renderer.blood(pos, fx.value ?? 1);
      break;
    case "melee": {
      if (fx.src != null) renderer.meleeSwing(fx.src);
      if (mine) renderer.viewmodelFire();
      audio.knife(mine ? 1 : fxVolume(fx.pos) * 0.7);
      break;
    }
    case "explosion": {
      renderer.explosion(pos, fx.color, fx.value ?? 4);
      const v = fxVolume(fx.pos, 80);
      audio.explosion(Math.max(0.15, v));
      renderer.shake(v * 1.2);
      break;
    }
    case "infect":
      renderer.explosion(pos, fx.color, 2);
      audio.infect();
      break;
    case "heal":
      if (onMe || mine || fxVolume(fx.pos, 12) > 0) audio.heal();
      break;
    case "frost":
      renderer.explosion(pos, 0x4fc3f7, 4);
      audio.ability();
      break;
    case "acid":
      renderer.explosion(pos, 0x9ccc65, 2);
      break;
    case "speed":
    case "leap":
    case "invisible":
    case "tongue":
      if (mine || fxVolume(fx.pos, 20) > 0.1) audio.ability();
      break;
    case "damage": {
      const headshot = fx.weapon === "headshot";
      if (mine) {
        if (fx.value != null) renderer.damageNumber(pos, fx.value, headshot);
        hitmarker(false);
        if (headshot) audio.headshot();
        else audio.hit();
      } else if (onMe) {
        flashHurt();
        damageDirection(fx.src, look.yaw);
        renderer.shake(Math.min(1, (fx.value ?? 10) / 60));
        audio.hurt();
      }
      break;
    }
    case "death": {
      const p = findPlayer(fx.dst);
      if (onMe) audio.death();
      else if (p) audio.death();
      if (mine) hitmarker(true);
      break;
    }
    case "pickup":
      if (fxVolume(fx.pos, 6) > 0.2) audio.buy();
      break;
  }
}
