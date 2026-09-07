import { MAP, worldX, worldZ } from "../shared/map.js";
import type { Vec3 } from "../shared/protocol.js";
import { WEAPONS, isMelee } from "../shared/weapons.js";
import { useAbility } from "./abilities.js";
import { startReload } from "./combat.js";
import type { Game } from "./game.js";
import { cellKey, findPath } from "./nav.js";
import { distance, emptyInput, eyePos, lineOfSight, lookAtYaw, type BotState, type Entity } from "./physics.js";

// ===== Bot AI — zumbis caçam pelo mapa (A*), humanos atiram, recuam e patrulham =====

const PATH_REFRESH = 0.6;
const MAX_PATHS_PER_TICK = 3;
// Pontos de patrulha: A site, B site, mid, long
const PATROL: Vec3[] = [
  { x: worldX(28), y: 0, z: worldZ(5) },
  { x: worldX(4), y: 0, z: worldZ(4) },
  { x: worldX(15), y: 0, z: worldZ(14) },
  { x: worldX(30), y: 0, z: worldZ(20) },
];

let pathsThisTick = 0;
let lastTickTime = -1;

function visible(a: Entity, b: Entity): boolean {
  return lineOfSight(eyePos(a), { x: b.pos.x, y: b.pos.y + 1, z: b.pos.z }, MAP.boxes);
}

/** Próximo waypoint na direção de `goal`, recalculando o A* quando necessário (limitado por tick). */
function nextWaypoint(e: Entity, state: BotState, goal: Vec3, time: number): Vec3 | null {
  const goalKey = cellKey(goal);
  const stale = state.pathAt == null || time - state.pathAt > PATH_REFRESH || state.pathGoal !== goalKey || !state.path?.length;
  if (stale && pathsThisTick < MAX_PATHS_PER_TICK) {
    pathsThisTick++;
    state.path = findPath(e.pos, goal);
    state.pathAt = time;
    state.pathGoal = goalKey;
  }
  const path = state.path;
  if (!path?.length) return null;
  // Avança waypoints já alcançados
  while (path.length > 1 && Math.hypot(path[0].x - e.pos.x, path[0].z - e.pos.z) < 1.2) path.shift();
  return path[0];
}

function updateStuck(e: Entity, state: BotState, target: Entity | null, time: number) {
  const moved = Math.hypot(e.pos.x - (state.lastX ?? e.pos.x), e.pos.z - (state.lastZ ?? e.pos.z));
  state.lastX = e.pos.x;
  state.lastZ = e.pos.z;
  if (moved > 1.5) state.stuck = false;
  if (!target) return;
  const d = distance(e.pos, target.pos);
  if (state.lastTargetAt == null || time - state.lastTargetAt > 1.5) {
    state.stuck = state.lastTargetDist != null && d > state.lastTargetDist - 0.5 && moved < 0.8;
    state.lastTargetDist = d;
    state.lastTargetAt = time;
  }
}

/** Move em direção a um ponto no mundo: define yaw + moveY (frente) e um strafe leve. */
function steerTo(e: Entity, state: BotState, target: Vec3, strafe: number): void {
  const yaw = lookAtYaw(e.pos, target);
  e.yaw = yaw + (state.stuck ? (Math.PI / 3) * state.strafeDir : 0);
  e.input.moveY = 1;
  e.input.moveX = strafe;
  e.input.jump = state.stuck === true;
}

export const botBrain = {
  think(e: Entity, game: Game) {
    if (!e.alive) return;
    const time = game.serverTime;
    if (time !== lastTickTime) {
      lastTickTime = time;
      pathsThisTick = 0;
    }
    const state = e.botState!;
    const others = game.players.filter((p) => p.id !== e.id && p.alive);
    if (time > state.strafeUntil) {
      state.strafeDir = Math.random() > 0.5 ? 1 : -1;
      state.strafeUntil = time + 1.5 + Math.random() * 2;
    }
    e.input = emptyInput(e.yaw);
    if (e.team === "zombie") thinkZombie(e, game, state, others, time);
    else thinkHuman(e, game, state, others, time);
  },
};

function thinkZombie(e: Entity, game: Game, state: BotState, others: Entity[], time: number) {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const o of others) {
    if (o.team === "zombie" || o.invisibleUntil > time) continue;
    const d = distance(e.pos, o.pos);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  updateStuck(e, state, best, time);
  if (!best) return;
  state.targetId = best.id;
  const los = visible(e, best);
  if (los) state.lastKnown = { ...best.pos };

  if (los && bestD < 10) {
    steerTo(e, state, best.pos, Math.cos(lookAtYaw(e.pos, best.pos)) * state.strafeDir * 0.3);
  } else {
    const goal = los ? best.pos : state.lastKnown ?? best.pos;
    const wp = nextWaypoint(e, state, goal, time);
    steerTo(e, state, wp ?? best.pos, 0);
  }
  e.pitch = 0;
  e.input.attack = bestD < 3;

  if (e.abilityCooldown <= 0 && e.cls.abilityCooldown > 0) {
    let use = false;
    switch (e.classId) {
      case "runner": use = bestD > 8 && bestD < 20; break;
      case "tank":
      case "nemesis": use = los && bestD > 6 && bestD < 15; break;
      case "smoker": use = los && bestD < 20 && bestD > 4; break;
      case "spitter": use = los && bestD < 25 && bestD > 5; break;
      case "witch": use = bestD < 3; break;
      default: use = los && bestD < 6 && Math.random() < 0.05;
    }
    if (use) {
      if (e.classId === "smoker" || e.classId === "spitter") e.pitch = Math.atan2(best.pos.y + 1 - eyePos(e).y, bestD);
      useAbility(game, e);
    }
  }
}

function thinkHuman(e: Entity, game: Game, state: BotState, others: Entity[], time: number) {
  const zombies = others.filter((o) => o.team === "zombie");
  let nearest: Entity | null = null;
  let nearestD = Infinity;
  let target: Entity | null = null;
  let targetD = Infinity;
  for (const z of zombies) {
    const d = distance(e.pos, z.pos);
    if (d < nearestD) {
      nearestD = d;
      nearest = z;
    }
    if (d < targetD && d < 60 && visible(e, z)) {
      targetD = d;
      target = z;
    }
  }
  updateStuck(e, state, target ?? nearest, time);
  if (target) state.lastKnown = { ...target.pos };

  // Compra uma primária ao nascer (grátis, estilo ZP)
  if (state.boughtAt !== e.spawnProtectUntil && !e.cls.lockedWeapon && game.inBuyZone(e)) {
    state.boughtAt = e.spawnProtectUntil;
    game.handleBuyWeapon(e.id, e.preferredPrimary || "m4a1");
  }

  // Recarga quando não há ameaça perto
  const w = WEAPONS[e.weapon];
  if (!isMelee(e.weapon) && e.ammo < w.magazine * 0.4 && e.reloading <= 0 && nearestD > 15) startReload(e);
  if (e.ammo === 0 && e.reserve === 0 && e.loadout[2] && e.slot === 1) game.handleSwitch(e.id, 2);

  const flee = nearest != null && nearestD < 8;
  state.flee = flee;

  if (flee && nearest) {
    // Recua para o spawn (ou aliado mais próximo) sem parar de atirar
    const ally = others.filter((o) => o.team === "human").sort((a, b) => distance(a.pos, e.pos) - distance(b.pos, e.pos))[0];
    const safe = ally && distance(ally.pos, e.pos) > 4 ? ally.pos : MAP.spawns[0].pos;
    const wp = nextWaypoint(e, state, safe, time);
    if (wp) steerTo(e, state, wp, 0);
    aimAndShoot(e, target ?? nearest, target != null);
    return;
  }

  if (target) {
    aimAndShoot(e, target, true);
    // Longe e parado: agacha para mirar melhor
    if (targetD > 25) e.input.crouch = true;
    else if (targetD < 18) {
      e.input.moveX = state.strafeDir * 0.6;
    }
    if (e.classId === "medic" && e.abilityCooldown <= 0) {
      const hurt = others.some((o) => o.team === "human" && o.hp < o.maxHp * 0.5 && distance(o.pos, e.pos) < 6);
      if (hurt || e.hp < e.maxHp * 0.5) useAbility(game, e);
    } else if (e.abilityCooldown <= 0 && e.hp < e.maxHp * 0.5 && Math.random() < 0.02) {
      useAbility(game, e);
    }
    return;
  }

  // Sem alvo visível: caça a última posição conhecida ou patrulha
  let goal = state.lastKnown;
  if (!goal || Math.hypot(goal.x - e.pos.x, goal.z - e.pos.z) < 3) {
    state.lastKnown = null;
    state.patrolIdx = state.patrolIdx ?? Math.floor(Math.random() * PATROL.length);
    goal = PATROL[state.patrolIdx];
    if (Math.hypot(goal.x - e.pos.x, goal.z - e.pos.z) < 3) {
      state.patrolIdx = (state.patrolIdx + 1) % PATROL.length;
      goal = PATROL[state.patrolIdx];
    }
  }
  const wp = nextWaypoint(e, state, goal, time);
  if (wp) steerTo(e, state, wp, 0);
  e.pitch = 0;
}

function aimAndShoot(e: Entity, target: Entity, canShoot: boolean) {
  const d = distance(e.pos, target.pos);
  const eye = eyePos(e);
  e.yaw = lookAtYaw(e.pos, target.pos);
  e.pitch = Math.atan2(target.pos.y + 0.9 - eye.y, d);
  const w = WEAPONS[e.weapon];
  const inRange = isMelee(e.weapon) ? d < w.range + 0.5 : d < Math.min(w.range, 60);
  e.input.attack = canShoot && inRange && e.reloading <= 0 && (isMelee(e.weapon) || e.ammo > 0);
  e.input.zoom = !!w.zoom && d > 15;
  if (!isMelee(e.weapon) && e.ammo === 0) startReload(e);
}
