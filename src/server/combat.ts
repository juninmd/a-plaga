import { BALANCE, STREAKS } from "../shared/balance.js";
import { MAP } from "../shared/map.js";
import type { Team, Vec3 } from "../shared/protocol.js";
import { RECOIL_ACCUM_PER_SHOT, WEAPONS, effectiveSpread, isMelee } from "../shared/weapons.js";
import type { Game } from "./game.js";
import { SYS } from "./narrator.js";
import { distance, eyePos, horizontalSpeed, lineOfSight, now, shootRay, type Entity } from "./physics.js";

// ===== Tiro (hitscan) =====

export function handleAttack(g: Game, e: Entity) {
  if (!e.input.attack || e.fireCooldown > 0 || e.reloading > 0) return;
  const w = WEAPONS[e.weapon];
  if (!w || isMelee(e.weapon)) return;
  // Semi-automáticas exigem um clique por tiro
  if (!w.auto && e.attackHeld) return;
  if (e.ammo <= 0) {
    startReload(e);
    return;
  }
  e.ammo--;
  e.fireCooldown = 1 / w.fireRate;
  const eye = eyePos(e);
  const spread = effectiveSpread(w, {
    moving: horizontalSpeed(e) > 1,
    airborne: !e.onGround,
    crouching: e.crouching,
    zoomed: e.input.zoom && !!w.zoom,
    recoilAccum: e.recoilAccum,
  });
  e.recoilAccum = Math.min(3, e.recoilAccum + RECOIL_ACCUM_PER_SHOT * w.recoil);
  for (let i = 0; i < w.pellets; i++) {
    const sx = (Math.random() - 0.5) * spread * 2;
    const sy = (Math.random() - 0.5) * spread * 2;
    const dir = {
      x: -Math.sin(e.yaw + sx) * Math.cos(e.pitch + sy),
      y: Math.sin(e.pitch + sy),
      z: -Math.cos(e.yaw + sx) * Math.cos(e.pitch + sy),
    };
    const res = shootRay(eye, dir, g.players, e.id, w.range);
    g.fx.push({ kind: "tracer", pos: res.end, color: w.color, from: { ...eye }, src: e.id, weapon: e.weapon });
    if (res.hit) {
      const target = g.players.find((p) => p.id === res.targetId);
      if (target && target.team !== e.team) {
        g.fx.push({ kind: "blood", pos: res.end, color: 0x8b0000, src: e.id, dst: target.id });
        const dmg = w.dmg * (res.headshot ? w.headshotMult : 1) * e.damageMult;
        damage(g, target, e, dmg, res.headshot, w.knockback * e.knockbackMult);
      }
    } else if (res.normal) {
      g.fx.push({ kind: "impact", pos: res.end, normal: res.normal, color: w.color, src: e.id });
    }
  }
  if (e.ammo <= 0) startReload(e);
}

export function startReload(e: Entity) {
  if (e.reloading > 0 || e.reserve <= 0) return;
  const w = WEAPONS[e.weapon];
  if (!w || isMelee(e.weapon) || e.ammo >= w.magazine) return;
  e.reloading = w.reloadTime;
  const refill = Math.min(w.magazine - e.ammo, e.reserve);
  e.reserve -= refill;
  e.ammo += refill;
}

// ===== Corpo a corpo (faca do humano e garra do zumbi) =====

export function handleMelee(g: Game, e: Entity) {
  if (!isMelee(e.weapon) || e.fireCooldown > 0) return;
  if (!e.isBot && !e.input.attack) return; // bots de zumbi atacam sozinhos
  if (e.isBot && e.team === "human" && !e.input.attack) return;
  const w = WEAPONS[e.weapon];
  const eye = eyePos(e);
  const fwdX = -Math.sin(e.yaw);
  const fwdZ = -Math.cos(e.yaw);
  for (const t of g.players) {
    if (!t.alive || t.team === e.team) continue;
    const d = distance(e.pos, t.pos);
    if (d >= w.range + BALANCE.playerRadius * 2) continue;
    // Só acerta o que está à frente e sem parede no meio
    const dx = t.pos.x - e.pos.x;
    const dz = t.pos.z - e.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    if ((dx / len) * fwdX + (dz / len) * fwdZ < 0.35) continue;
    if (!lineOfSight(eye, { x: t.pos.x, y: t.pos.y + 1, z: t.pos.z }, MAP.boxes)) continue;
    e.fireCooldown = 1 / w.fireRate;
    const dmg = (e.classId === "witch" ? 200 : w.dmg) * e.damageMult;
    g.fx.push({ kind: "melee", pos: { ...t.pos, y: t.pos.y + 1 }, color: w.color, src: e.id, dst: t.id, weapon: e.weapon });
    damage(g, t, e, dmg, false, w.knockback * e.knockbackMult);
    return;
  }
  // Errou: ainda assim "balança" (cooldown) quando o jogador clicou
  if (!e.isBot) {
    e.fireCooldown = 1 / w.fireRate;
    g.fx.push({ kind: "melee", pos: { ...e.pos, y: e.pos.y + 1 }, color: w.color, src: e.id, weapon: e.weapon });
  }
}

// ===== Dano / morte / infecção =====

export function damage(g: Game, target: Entity, source: Entity, baseDmg: number, headshot: boolean, knockback: number) {
  if (!target.alive) return;
  if (target.spawnProtectUntil > now()) return;
  let dmg = baseDmg;
  if (target.team === "zombie" && !target.isBoss) dmg *= BALANCE.zombieDefenseMult;
  if (target.isBoss && target.team === "zombie") dmg *= 0.5;

  // Armadura absorve 40%
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, dmg * 0.4);
    target.armor -= absorbed;
    dmg -= absorbed;
  }
  target.hp -= dmg;
  target.lastHitBy = source.id;
  target.lastHitAt = now();
  const dx = target.pos.x - source.pos.x;
  const dz = target.pos.z - source.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  const kb = knockback * BALANCE.knockbackPower * target.knockbackMult;
  target.vel.x += (dx / len) * kb;
  target.vel.z += (dz / len) * kb;

  if (source.team === "human" && !source.isBot) {
    const gain = Math.floor(dmg / BALANCE.apDamageDiv);
    if (gain > 0) g.addAp(source.id, gain);
  }

  g.fx.push({
    kind: "damage",
    pos: { ...target.pos, y: target.pos.y + 1.2 },
    color: headshot ? 0xffd54f : 0xff5252,
    value: Math.round(dmg),
    src: source.id,
    dst: target.id,
    weapon: headshot ? "headshot" : undefined,
  });

  if (target.hp <= 0) killEntity(g, target, source, headshot);
}

export function killEntity(g: Game, target: Entity, source: Entity, headshot: boolean) {
  target.alive = false;
  target.deaths++;
  source.kills++;
  source.streak++;
  g.fx.push({ kind: "death", pos: { ...target.pos }, color: target.team === "zombie" ? 0x4caf50 : 0xff5252, src: source.id, dst: target.id });

  if (target.team === "zombie") g.dropAmmoPack({ x: target.pos.x, y: 0, z: target.pos.z });

  let streakLabel: string | undefined;
  for (const s of STREAKS) if (source.streak === s.kills) streakLabel = s.label;

  const entry = {
    killer: source.name,
    victim: target.name,
    weapon: WEAPONS[source.weapon]?.name ?? "Garra",
    headshot,
    streak: source.streak,
    streakLabel,
  };
  g.kills.push(entry);

  if (!source.isBot) g.addAp(source.id, target.team === "zombie" ? BALANCE.apKillZombie : BALANCE.apKillHuman);

  if (target.classId === "boomer") explodeAt(g, target.pos, 4.5, 40, target.team, source);

  const canInfect = g.round.mode !== "swarm" && g.round.mode !== "armageddon";
  if (target.team === "human" && canInfect) {
    infect(g, target, source, false);
    g.broadcastChat(`${target.name} se juntou à horda.`, true, 0x00e676);
  }
  target.respawnAt = now() + BALANCE.respawnDelay;
  if (!target.isBot) g.sendTo(target.id, { t: "self", d: g.playerState(target) });
  g.countTeams();
}

export function infect(g: Game, target: Entity, source: Entity | null, first: boolean) {
  target.team = "zombie";
  g.applyClass(target, "classic");
  target.isBoss = false;
  if (source) {
    source.infections++;
    if (!source.isBot) g.addAp(source.id, BALANCE.apInfect);
    g.broadcastChat(SYS.infection(source.name, target.name), true);
  }
  if (!target.isBot) g.sendTo(target.id, { t: "self", d: g.playerState(target) });
  if (first) {
    target.buffSpeed = BALANCE.firstZombieFurySpeed;
    target.buffSpeedUntil = now() + 10;
    target.damageMult = BALANCE.firstZombieFuryDamage;
    target.buffDamageUntil = now() + 10;
  }
  g.fx.push({ kind: "infect", pos: { ...target.pos, y: target.pos.y + 1 }, color: 0x00e676 });
  g.countTeams();
}

export function explodeAt(g: Game, pos: Vec3, radius: number, dmg: number, team: Team, source: Entity) {
  g.fx.push({ kind: "explosion", pos, color: 0xff6d00, value: radius });
  for (const p of g.players) {
    if (!p.alive || p.team === team) continue;
    const d = distance(p.pos, pos);
    if (d < radius) {
      const falloff = 1 - d / radius;
      damage(g, p, source, dmg * falloff, false, 6 * falloff);
    }
  }
}
