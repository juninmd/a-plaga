import { WEAPONS } from "../shared/balance.js";
import { MAP } from "../shared/map.js";
import type { Entity } from "./physics.js";
import { distance, lineOfSight, lookAtYaw } from "./physics.js";
import type { Game } from "./game.js";

// ===== Bot AI — zumbis perseguem, humanos atiram e recuam =====

export const botBrain = {
  think(e: Entity, game: Game) {
    if (!e.alive) return;
    const state = e.botState!;
    const others = game.players.filter((p) => p.id !== e.id && p.alive);

    // Detecção de stuck: sem progresso em direção ao alvo por 1.5s -> vira e tenta
    const moved = Math.hypot(e.pos.x - (state.lastX ?? e.pos.x), e.pos.z - (state.lastZ ?? e.pos.z));
    state.lastX = e.pos.x;
    state.lastZ = e.pos.z;
    if (moved > 1.5) {
      state.stuck = false;
    }
    // Mede progresso pela distância ao alvo atual
    const target = others.find((o) => o.id === state.targetId) ?? others[0];
    if (target) {
      const d = distance(e.pos, target.pos);
      if (state.lastTargetAt == null || game.serverTime - state.lastTargetAt > 1.5) {
        if (state.lastTargetDist != null && d > state.lastTargetDist - 0.5) {
          state.stuck = true;
        }
        state.lastTargetDist = d;
        state.lastTargetAt = game.serverTime;
      }
    }

    if (e.team === "zombie") {
      // Encontra humano mais próximo
      let best: Entity | null = null;
      let bestD = Infinity;
      for (const o of others) {
        if (o.team !== "zombie") {
          const d = distance(e.pos, o.pos);
          if (d < bestD) {
            bestD = d;
            best = o;
          }
        }
      }
      if (!best) {
        e.input = { moveX: 0, moveY: 0, jump: false, attack: false, ability: false, yaw: e.yaw, pitch: 0 };
        return;
      }
      // Strafe suave para não empilhar em linha reta
      if (game.serverTime > state.strafeUntil) {
        state.strafeDir = Math.random() > 0.5 ? 1 : -1;
        state.strafeUntil = game.serverTime + 1.5 + Math.random() * 2;
      }
      const targetYaw = lookAtYaw(e.pos, best.pos);
      // Desvio de obstáculo: quando preso, gira 120° e pula para se soltar
      const steer = state.stuck ? (Math.PI * 2 / 3) * state.strafeDir : 0;
      e.yaw = targetYaw + steer;
      e.pitch = 0;
      e.input = {
        moveX: Math.cos(targetYaw) * state.strafeDir * 0.4,
        moveY: 1,
        jump: state.stuck === true,
        attack: false,
        ability: e.abilityCooldown <= 0 && bestD > 6 && Math.random() < 0.02 && e.cls.abilityCooldown > 0,
        yaw: e.yaw,
        pitch: 0,
      };
      if (e.input.ability) game.useAbility(e);
    } else {
      // Humano: mira no zumbi mais próximo no alcance, recua se perto
      let best: Entity | null = null;
      let bestD = Infinity;
      for (const o of others) {
        if (o.team === "zombie") {
          const d = distance(e.pos, o.pos);
          if (d < bestD) {
            bestD = d;
            best = o;
          }
        }
      }
      if (!best) {
        e.input = { moveX: 0, moveY: 0, jump: false, attack: false, ability: false, yaw: e.yaw, pitch: 0 };
        return;
      }
      const targetYaw = lookAtYaw(e.pos, best.pos);
      const tooClose = bestD < 10;
      state.flee = tooClose;
      const steer = state.stuck ? Math.PI / 3 * state.strafeDir : 0;
      // Mira no peito do alvo (y + 0.9), não pitch fixo — garante acerto a longa distância
      const eye = { x: e.pos.x, y: e.pos.y + 1.6, z: e.pos.z };
      const pitch = Math.atan2((best.pos.y + 0.9) - eye.y, bestD);
      e.yaw = targetYaw + steer;
      e.pitch = pitch;
      // Recarga automática
      if (e.ammo === 0 && e.reloading <= 0) {
        const w = WEAPONS[e.weapon];
        e.reloading = w.reloadTime;
        const refill = Math.min(w.magazine, e.reserve);
        e.reserve -= refill;
        e.ammo = refill;
      }
      // Só atira com linha de visão livre
      const hasLos = lineOfSight(eye, { x: best.pos.x, y: best.pos.y + 1, z: best.pos.z }, MAP.boxes);
      const canShoot = bestD < 45 && e.ammo > 0 && e.reloading <= 0 && hasLos;
      // Sem LOS e longe: avança para ganhar visão (caça ativa)
      const seek = !hasLos && bestD < 50 && bestD > 12;
      if (seek && game.serverTime > state.strafeUntil) {
        state.strafeDir = Math.random() > 0.5 ? 1 : -1;
        state.strafeUntil = game.serverTime + 1 + Math.random();
      }
      e.input = {
        // Kite: recua atirando (velocidade de ré menor — o zumbi alcança)
        moveX: state.flee ? (Math.random() > 0.5 ? 0.5 : -0.5) : seek ? state.strafeDir * 0.6 : 0,
        moveY: state.flee ? -0.7 : seek ? 1 : 0,
        jump: false,
        attack: canShoot,
        ability: e.abilityCooldown <= 0 && e.hp < e.maxHp * 0.5 && Math.random() < 0.01,
        yaw: e.yaw,
        pitch: e.pitch,
      };
      if (e.input.ability && e.classId === "medic") game.useAbility(e);
    }
  },
};
