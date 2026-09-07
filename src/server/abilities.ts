import { BALANCE, ITEM_INDEX } from "../shared/balance.js";
import { MAP } from "../shared/map.js";
import type { Vec3 } from "../shared/protocol.js";
import { WEAPONS } from "../shared/weapons.js";
import { damage, explodeAt } from "./combat.js";
import type { Game, Projectile } from "./game.js";
import { SYS } from "./narrator.js";
import { distance, eyePos, forward, lineOfSight, now, type Entity } from "./physics.js";

// ===== Habilidades (tecla de habilidade) =====

export function useAbility(g: Game, e: Entity) {
  if (e.abilityCooldown > 0 || !e.alive) return;
  const c = e.cls;
  if (c.abilityCooldown <= 0) return; // passiva (boomer) / sem habilidade
  e.abilityCooldown = c.abilityCooldown;
  const eye = eyePos(e);
  const fwd = forward(e);

  switch (e.classId) {
    case "runner":
      e.buffSpeed = 1.5;
      e.buffSpeedUntil = now() + 3;
      g.fx.push({ kind: "speed", pos: e.pos, color: 0xffb300 });
      break;
    case "tank":
      e.vel.y = BALANCE.jumpVel * 2.2;
      e.vel.x = fwd.x * 14;
      e.vel.z = fwd.z * 14;
      g.fx.push({ kind: "leap", pos: e.pos, color: 0x8d6e63 });
      break;
    case "smoker": {
      const target = raycastPlayers(g, e, 40);
      if (target) {
        g.fx.push({ kind: "tongue", pos: target.pos, from: { ...eye }, color: 0x7cb342, src: e.id, dst: target.id });
        target.vel.x = (e.pos.x - target.pos.x) * 3;
        target.vel.z = (e.pos.z - target.pos.z) * 3;
      }
      break;
    }
    case "spitter":
      g.projectiles.push({ id: g.nextProjId++, kind: "acid", pos: { ...eye }, vel: { x: fwd.x * 22, y: fwd.y * 22 + 3, z: fwd.z * 22 }, owner: e.id, ttl: 2 });
      break;
    case "witch": {
      const target = raycastPlayers(g, e, 3.5);
      if (target) damage(g, target, e, 200, false, 3);
      break;
    }
    case "nemesis":
      e.vel.y = BALANCE.jumpVel * 2.4;
      e.vel.x = fwd.x * 18;
      e.vel.z = fwd.z * 18;
      g.fx.push({ kind: "leap", pos: e.pos, color: 0xff1744 });
      break;
    case "assault":
      g.projectiles.push({ id: g.nextProjId++, kind: "fire_grenade", pos: { ...eye }, vel: { x: fwd.x * 20, y: fwd.y * 20 + 5, z: fwd.z * 20 }, owner: e.id, ttl: 3 });
      break;
    case "medic":
      for (const p of g.players) {
        if (!p.alive || p.team !== "human") continue;
        if (distance(p.pos, e.pos) < 6) {
          p.hp = Math.min(p.maxHp, p.hp + 50);
          g.fx.push({ kind: "heal", pos: p.pos, color: 0x00e676, dst: p.id });
        }
      }
      break;
    case "heavy":
      e.buffSpeed = 1.5;
      e.buffSpeedUntil = now() + 5;
      g.fx.push({ kind: "speed", pos: e.pos, color: 0xef5350 });
      break;
    case "ghost":
      e.invisibleUntil = now() + 5;
      g.fx.push({ kind: "invisible", pos: e.pos, color: 0xcfd8dc });
      break;
    case "doomslayer":
      e.buffSpeed = 1.6;
      e.buffSpeedUntil = now() + 4;
      e.damageMult = 2;
      e.buffDamageUntil = now() + 4;
      g.fx.push({ kind: "speed", pos: e.pos, color: 0xb71c1c });
      break;
  }
}

function raycastPlayers(g: Game, e: Entity, range: number): Entity | null {
  const eye = eyePos(e);
  let best: Entity | null = null;
  let bestD = range;
  for (const p of g.players) {
    if (!p.alive || p.id === e.id || p.team === e.team) continue;
    const d = distance(eye, p.pos);
    if (d < bestD && lineOfSight(eye, { x: p.pos.x, y: p.pos.y + 1, z: p.pos.z }, MAP.boxes)) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// ===== Itens extras (AP) =====

export function buyItem(g: Game, e: Entity, itemId: string) {
  const item = ITEM_INDEX[itemId];
  if (!item) return;
  if (item.side !== "both" && item.side !== e.team) return;
  const ap = g.getAp(e.id);
  if (ap < item.cost) {
    g.sendTo(e.id, { t: "error", d: SYS.notEnoughAp() });
    return;
  }
  const owned = g.owned.get(e.id)!;
  if (owned.has(itemId)) {
    g.sendTo(e.id, { t: "error", d: "Item já comprado neste round." });
    return;
  }
  owned.add(itemId);
  g.ap.set(e.id, ap - item.cost);
  applyItem(g, e, itemId);
  g.sendTo(e.id, { t: "shop", d: { ap: g.getAp(e.id), owned: [...owned] } });
  g.sendTo(e.id, { t: "chat", d: { name: "A PRAGA", text: SYS.bought(item.name, item.cost), system: true, color: 0xffee58 } });
}

function applyItem(g: Game, e: Entity, itemId: string) {
  switch (itemId) {
    case "adrenaline":
      e.buffSpeed = 1.4;
      e.buffSpeedUntil = now() + 8;
      break;
    case "medkit":
      e.hp = Math.min(e.maxHp, e.hp + 60);
      break;
    case "fire_grenade":
    case "frost_grenade":
    case "pipebomb":
      throwGrenade(g, e, itemId);
      break;
    case "armor":
      e.armor = Math.min(200, e.armor + 100);
      break;
    case "zombie_speed":
      e.buffSpeed = 1.3;
      e.buffSpeedUntil = now() + 10;
      break;
    case "zombie_heal":
      e.hp = Math.min(e.maxHp, e.hp + 500);
      break;
    case "zombie_rage":
      e.damageMult = 1.5;
      e.buffDamageUntil = now() + 8;
      break;
    case "zombie_dash": {
      const fwd = forward(e);
      e.vel.x = fwd.x * 22;
      e.vel.z = fwd.z * 22;
      e.vel.y = 6;
      break;
    }
  }
}

function throwGrenade(g: Game, e: Entity, kind: string) {
  const eye = eyePos(e);
  const fwd = forward(e);
  g.projectiles.push({ id: g.nextProjId++, kind, pos: { ...eye }, vel: { x: fwd.x * 24, y: fwd.y * 24 + 6, z: fwd.z * 24 }, owner: e.id, ttl: 4 });
}

// ===== Projéteis =====

export function updateProjectiles(g: Game, dt: number) {
  const dead: Projectile[] = [];
  for (const pr of g.projectiles) {
    pr.ttl -= dt;
    pr.vel.y -= BALANCE.gravity * 0.6 * dt;
    pr.pos.x += pr.vel.x * dt;
    pr.pos.y += pr.vel.y * dt;
    pr.pos.z += pr.vel.z * dt;
    if (pr.pos.y < 0) {
      pr.pos.y = 0;
      pr.vel.y = 0;
    }
    if (pr.ttl <= 0 || pr.pos.y <= 0.01) {
      explodeProjectile(g, pr);
      dead.push(pr);
    }
  }
  if (dead.length) g.projectiles = g.projectiles.filter((p) => !dead.includes(p));
}

export function explodeProjectile(g: Game, pr: Projectile) {
  const owner = g.players.find((p) => p.id === pr.owner);
  if (!owner) return;
  switch (pr.kind) {
    case "fire_grenade":
      explodeAt(g, pr.pos, 4, 120, owner.team, owner);
      break;
    case "frost_grenade":
      explodeAt(g, pr.pos, 5, 5, owner.team, owner);
      for (const p of g.players) {
        if (!p.alive || p.team === owner.team) continue;
        if (distance(p.pos, pr.pos) < 5) {
          p.frozenUntil = now() + 3;
          p.vel.x = 0;
          p.vel.z = 0;
          p.fireCooldown = Math.max(p.fireCooldown, 3);
        }
      }
      g.fx.push({ kind: "frost", pos: pr.pos, color: 0x4fc3f7 });
      break;
    case "pipebomb":
      explodeAt(g, pr.pos, 6.5, 300, owner.team, owner);
      break;
    case "acid":
      g.fx.push({ kind: "acid", pos: pr.pos, color: 0x9ccc65, value: 5 });
      for (const p of g.players) {
        if (!p.alive || p.team === owner.team) continue;
        if (distance(p.pos, pr.pos) < 3) damage(g, p, owner, 25, false, 1);
      }
      break;
  }
}

// ===== Pickups (ammo packs físicos) =====

export function dropAmmoPack(g: Game, pos: Vec3) {
  g.pickups.push({ id: g.nextPickupId++, kind: "ammopack", pos: { ...pos, y: 0.5 }, value: 10, until: g.serverTime + 30 });
}

export function updatePickups(g: Game) {
  g.pickups = g.pickups.filter((p) => g.serverTime < p.until);
  for (const p of g.players) {
    if (!p.alive) continue;
    for (const pk of g.pickups) {
      if (distance(p.pos, pk.pos) >= 1.6) continue;
      pk.until = 0;
      if (p.team === "human") {
        const w = WEAPONS[p.weapon];
        if (w) p.reserve = Math.min(w.reserve, p.reserve + w.magazine * 2);
      }
      if (!p.isBot) {
        g.addAp(p.id, pk.value);
        g.sendTo(p.id, { t: "chat", d: { name: "A PRAGA", text: SYS.ammoPicked(pk.value), system: true, color: 0x00e676 } });
      }
      g.fx.push({ kind: "pickup", pos: pk.pos, color: 0x00e676, dst: p.id });
      break;
    }
  }
  g.pickups = g.pickups.filter((p) => g.serverTime < p.until);
}
