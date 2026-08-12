import {
  BALANCE,
  CLASS_INDEX,
  HUMAN_CLASSES,
  ITEM_INDEX,
  MODES,
  MODE_INDEX,
  STREAKS,
  WEAPONS,
  ZOMBIE_CLASSES,
} from "../shared/balance.js";
import { MAP } from "../shared/map.js";
import type {
  ChatMessage,
  FxEvent,
  GameMode,
  InputState,
  KillFeedEntry,
  PickupState,
  PlayerState,
  ProjectileState,
  RoundInfo,
  ServerSnapshot,
  Team,
  Vec3,
} from "../shared/protocol.js";
import { narrate, SYS } from "./narrator.js";
import { createEntity, distance, lineOfSight, moveEntity, now, setTime, shootRay, type Entity } from "./physics.js";

export interface ClientCtx {
  send(msg: unknown): void;
}

interface Pickup {
  id: number;
  kind: "ammopack" | "weapon";
  pos: Vec3;
  value: number;
  until: number;
}

interface Projectile {
  id: number;
  kind: string;
  pos: Vec3;
  vel: Vec3;
  owner: number;
  ttl: number;
}

interface BotBrain {
  think(e: Entity, game: Game): void;
}

const BOT_TARGET_COUNT = 8;

export class Game {
  players: Entity[] = [];
  clients = new Map<number, ClientCtx>();
  pickups: Pickup[] = [];
  projectiles: Projectile[] = [];
  chats: ChatMessage[] = [];
  kills: KillFeedEntry[] = [];
  fx: FxEvent[] = [];
  round: RoundInfo = {
    mode: "infection",
    phase: "countdown",
    timeLeft: BALANCE.countdownTime,
    zombies: 0,
    humans: 0,
    firstZombie: "",
    modeLabel: "",
  };
  serverTime = 0;
  private roundNumber = 0;
  private lastMode: GameMode | null = null;
  private nextId = 1;
  private nextPickupId = 1;
  private nextProjId = 1;
  private accumulated = 0;
  private ap = new Map<number, number>();
  private owned = new Map<number, Set<string>>();
  private botBrain: BotBrain;

  constructor(brain?: BotBrain) {
    this.botBrain = brain ?? { think: () => {} };
  }

  // ===== Lifecycle =====

  addPlayer(name: string, ctx: ClientCtx): number {
    const id = this.nextId++;
    const cls = HUMAN_CLASSES[0];
    const e = createEntity(id, name, cls, "human", false);
    e.weapon = cls.weapon ?? "rifle";
    const w = WEAPONS[e.weapon];
    e.ammo = w.magazine;
    e.reserve = w.reserve;
    this.players.push(e);
    this.clients.set(id, ctx);
    this.ap.set(id, BALANCE.apStarting);
    this.owned.set(id, new Set());
    this.spawnAtRandom(e);
    this.broadcastChat(`${name} entrou na arena. Que delícia.`, true, 0x00e676);
    return id;
  }

  removePlayer(id: number) {
    this.players = this.players.filter((p) => p.id !== id);
    this.clients.delete(id);
    this.ap.delete(id);
    this.owned.delete(id);
  }

  ensureBots() {
    const need = Math.max(0, BOT_TARGET_COUNT - this.players.length);
    // Mantém a proporção do time em mente: bot humano quando faltam humanos
    for (let i = 0; i < need; i++) {
      const zombies = this.players.filter((p) => p.team === "zombie").length;
      const humansCount = this.players.filter((p) => p.team === "human").length;
      const preferZombie = humansCount > 2 && zombies < humansCount * 0.8;
      const team: Team = preferZombie ? "zombie" : "human";
      const id = this.nextId++;
      const cls =
        team === "zombie"
          ? ZOMBIE_CLASSES[Math.floor(Math.random() * ZOMBIE_CLASSES.length)]
          : HUMAN_CLASSES[0];
      const e = createEntity(id, `Bot_${String.fromCharCode(65 + (this.players.length % 26))}`, cls, team, true);
      e.weapon = cls.weapon ?? (team === "human" ? "rifle" : "knife");
      const w = WEAPONS[e.weapon];
      e.ammo = w.magazine;
      e.reserve = w.reserve;
      e.botState = { strafeDir: 1, strafeUntil: 0, targetId: -1, flee: false };
      this.players.push(e);
      this.ap.set(id, BALANCE.apStarting);
      this.owned.set(id, new Set());
      this.spawnAtRandom(e);
    }
  }

  // ===== Spawn =====

  spawnAtRandom(e: Entity) {
    const pool = e.team === "zombie" ? MAP.zombieSpawns : MAP.spawns;
    const s = pool[Math.floor(Math.random() * pool.length)];
    e.pos = { x: s.pos.x, y: 0, z: s.pos.z };
    e.yaw = s.yaw;
    e.pitch = 0;
    e.vel = { x: 0, y: 0, z: 0 };
    e.alive = true;
    e.respawnAt = 0;
    e.hp = e.maxHp;
    e.armor = e.cls.armor ?? 0;
    e.spawnProtectUntil = now() + BALANCE.spawnProtection;
    e.buffSpeed = 1;
    e.buffSpeedUntil = 0;
    e.invisibleUntil = 0;
    e.reloading = 0;
    e.abilityCooldown = 0;
    if (!e.isBot) {
      this.sendTo(e.id, { t: "self", d: this.selfState(e) });
    }
  }

  private applyClass(e: Entity, classId: string) {
    const def = CLASS_INDEX[classId];
    if (!def) return;
    if (e.team !== def.side) return;
    e.cls = def;
    e.classId = def.id;
    e.maxHp = def.hp;
    e.hp = def.hp;
    e.speedMult = def.speed;
    e.gravityMult = def.gravity;
    e.knockbackMult = def.knockback;
    e.scale = def.scale ?? 1;
    e.armor = def.armor ?? e.armor;
    if (def.weapon && e.team === "human") {
      e.weapon = def.weapon;
      const w = WEAPONS[def.weapon];
      e.ammo = w.magazine;
      e.reserve = w.reserve;
    }
  }

  // ===== Round management =====

  private chooseMode(): GameMode {
    // Sem repetir modo consecutivo (zp_prevent_consecutive_modes)
    let best: GameMode = "infection";
    let bestScore = 0;
    for (const m of MODES) {
      if (m.id === this.lastMode) continue;
      const score = Math.random() / m.chance;
      if (score > bestScore) {
        bestScore = score;
        best = m.id;
      }
    }
    return best;
  }

  startRound() {
    this.roundNumber++;
    const mode = this.chooseMode();
    this.lastMode = mode;
    const def = MODE_INDEX[mode];
    this.round = {
      mode,
      phase: "countdown",
      timeLeft: BALANCE.countdownTime,
      zombies: 0,
      humans: 0,
      firstZombie: "",
      modeLabel: def.label,
    };
    this.pickups = [];
    this.projectiles = [];

    // Respawn de todos
    const allPlayers = this.players;
    // Times resetam por padrão: todos humanos no início do round
    // (modos swarm/armageddon definem times por conta própria)
    const resetsTeams = mode !== "swarm";
    for (const p of allPlayers) {
      if (resetsTeams) p.team = "human";
      p.alive = true;
      p.kills = 0;
      p.streak = 0;
      p.infections = 0;
      this.spawnAtRandom(p);
      // Reaplica a classe preferida (mantida entre rounds), senão a padrão
      const preferred = CLASS_INDEX[p.preferredClass];
      const fallback = p.team === "zombie" ? "classic" : "assault";
      const want = preferred && preferred.side === p.team ? p.preferredClass : fallback;
      this.applyClass(p, want);
      if (p.team === "zombie") p.weapon = "knife";
      else {
        const w = WEAPONS[p.weapon];
        p.ammo = w.magazine;
        p.reserve = w.reserve;
      }
      this.sendTo(p.id, { t: "shop", d: { ap: this.getAp(p.id), owned: [...this.owned.get(p.id)!] } });
    }

    const humans = allPlayers.filter((p) => p.team === "human");
    const zombies = allPlayers.filter((p) => p.team === "zombie");

    // Configuração do modo
    switch (mode) {
      case "infection": {
        const first = humans[Math.floor(Math.random() * humans.length)];
        if (first) {
          this.infect(first, null, true);
          this.round.firstZombie = first.name;
        }
        break;
      }
      case "multi": {
        const ratio = 0.15;
        const count = Math.max(2, Math.floor(humans.length * ratio));
        const shuffled = [...humans].sort(() => Math.random() - 0.5);
        for (let i = 0; i < count && i < shuffled.length; i++) {
          this.infect(shuffled[i], null, true);
        }
        break;
      }
      case "swarm": {
        // Sem infecção — times já definidos, zumbis mantêm HP alto
        const targetZombies = Math.max(3, Math.floor(allPlayers.length * 0.5));
        const toZombie = allPlayers.filter((p) => p.team === "human").slice(0, targetZombies);
        for (const p of toZombie) this.infect(p, null, true);
        for (const z of allPlayers.filter((p) => p.team === "zombie")) {
          z.maxHp = Math.max(z.maxHp, 1200);
          z.hp = z.maxHp;
        }
        break;
      }
      case "nemesis": {
        // Garante 1 zumbi para virar Nemesis
        if (zombies.length === 0 && humans.length > 0) {
          const h = humans[Math.floor(Math.random() * humans.length)];
          this.infect(h, null, false);
        }
        const target = this.players.find((p) => p.team === "zombie");
        if (target) {
          this.applyClass(target, "nemesis");
          target.isBoss = true;
          target.weapon = "knife";
          this.round.firstZombie = target.name;
        }
        break;
      }
      case "survivor": {
        const target = humans[0];
        if (target) {
          this.applyClass(target, "survivor");
          target.isBoss = true;
          this.round.firstZombie = target.name;
        }
        break;
      }
      case "plague": {
        const z = zombies[0] ?? humans[Math.floor(Math.random() * Math.max(1, humans.length))];
        const h = humans[0];
        if (z) {
          if (z.team === "human") this.infect(z, null, false);
          this.applyClass(z, "nemesis");
          z.isBoss = true;
        }
        if (h && h !== z) {
          this.applyClass(h, "survivor");
          h.isBoss = true;
        }
        break;
      }
      case "armageddon": {
        const half = Math.floor(allPlayers.length / 2);
        const shuffled = [...allPlayers].sort(() => Math.random() - 0.5);
        for (let i = 0; i < half; i++) {
          const p = shuffled[i];
          p.team = "zombie";
          this.applyClass(p, "nemesis");
          p.isBoss = true;
          p.weapon = "knife";
        }
        for (let i = half; i < shuffled.length; i++) {
          const p = shuffled[i];
          p.team = "human";
          this.applyClass(p, "survivor");
          p.isBoss = true;
        }
        for (const p of allPlayers) this.spawnAtRandom(p);
        break;
      }
    }

    this.countTeams();
    this.broadcast({ t: "roundStart", d: { ...this.round } });
    this.broadcastChat(this.roundIntro(mode));
  }

  private roundIntro(mode: GameMode): string {
    const modeName = MODE_INDEX[mode].label;
    let ev: Parameters<typeof narrate>[0] = "round_start";
    switch (mode) {
      case "multi": ev = "multi"; break;
      case "plague": ev = "plague"; break;
      case "armageddon": ev = "armageddon"; break;
      case "swarm": ev = "swarm"; break;
      case "nemesis": ev = "nemesis"; break;
      case "survivor": ev = "survivor"; break;
    }
    return `[${modeName}] ${narrate(ev, this.round.firstZombie)}`;
  }

  private endRound(winner: Team | "draw", reason: string) {
    this.round.phase = "over";
    this.round.timeLeft = 5;
    this.broadcast({ t: "roundEnd", d: { winner, reason } });
    // Recompensas
    for (const p of this.players) {
      const ap = this.getAp(p.id);
      const bonus = winner === "draw" ? 0 : p.team === winner ? BALANCE.apWinner : BALANCE.apLoser;
      this.ap.set(p.id, ap + bonus);
      this.sendTo(p.id, { t: "shop", d: { ap: this.getAp(p.id), owned: [...this.owned.get(p.id)!] } });
    }
    const ev =
      winner === "zombie" ? "zombie_win" : winner === "human" ? "human_win" : "draw";
    this.broadcastChat(`🦴 ${narrate(ev)}`);
    this.broadcastChat(`Resultado: ${reason}`, true);
    // Espera e reinicia
    setTimeout(() => this.startRound(), 5000);
  }

  // ===== Tick =====

  tick(dt: number) {
    setTime(this.serverTime);
    this.accumulated += dt;

    if (this.round.phase === "countdown") {
      this.round.timeLeft -= dt;
      this.updatePickups();
      if (this.round.timeLeft <= 0) {
        this.round.phase = "hunt";
        this.round.timeLeft = BALANCE.roundTime;
        this.broadcast({ t: "roundStart", d: { ...this.round } });
      }
    } else if (this.round.phase === "hunt" || this.round.phase === "last_human") {
      this.round.timeLeft -= dt;
      this.updatePlayers(dt);
      this.updateProjectiles(dt);
      this.updatePickups();
      this.checkRoundEnd();
      if (this.round.timeLeft <= 0) {
        this.endRound("human", "Tempo esgotado — humanos sobreviveram");
      }
    } else {
      // over — só pickups para limpar
      this.pickups = this.pickups.filter((p) => this.serverTime < p.until);
    }

    this.serverTime += dt;
  }

  private updatePlayers(dt: number) {
    const SUB = 4;
    const subDt = dt / SUB;
    for (const e of this.players) {
      if (!e.alive) {
        // Respawn com delay (deathmatch)
        if (e.respawnAt > 0 && now() >= e.respawnAt && this.round.phase === "hunt") {
          this.spawnAtRandom(e);
        }
        continue;
      }
      if (e.isBot) this.botBrain.think(e, this);
      // Sub-passos: evita atravessar alvos entre ticks (13u/tick @ 260u/s)
      for (let s = 0; s < SUB; s++) {
        moveEntity(e, subDt);
        this.handleAttack(e);
        if (e.team === "zombie") this.handleZombieMelee(e);
      }
      if (e.reloading > 0) e.reloading -= dt;
      if (e.fireCooldown > 0) e.fireCooldown -= dt;
      if (e.abilityCooldown > 0) e.abilityCooldown -= dt;
    }
  }

  // ===== Combate =====

  private handleAttack(e: Entity) {
    if (!e.input.attack || e.fireCooldown > 0 || e.reloading > 0) return;
    const w = WEAPONS[e.weapon];
    if (e.ammo <= 0) {
      this.startReload(e);
      return;
    }
    e.ammo--;
    e.fireCooldown = 1 / w.fireRate;
    const eye = { x: e.pos.x, y: e.pos.y + BALANCE.eyeHeight * e.scale, z: e.pos.z };
    for (let i = 0; i < w.pellets; i++) {
      const spread = (Math.random() - 0.5) * w.spread * 2;
      const spreadY = (Math.random() - 0.5) * w.spread * 2;
      // Frente do jogador: yaw=0 olha para -z (consistente com moveEntity)
      const dir = {
        x: -Math.sin(e.yaw + spread) * Math.cos(e.pitch + spreadY),
        y: Math.sin(e.pitch + spreadY),
        z: -Math.cos(e.yaw + spread) * Math.cos(e.pitch + spreadY),
      };
      const res = shootRay(eye, dir, this.players, e.id, w.range);
      this.fx.push({ kind: "tracer", pos: res.end, color: w.color });
      if (res.hit) {
        const target = this.players.find((p) => p.id === res.targetId);
        if (target && target.team !== e.team) {
          const dmg = w.dmg * (res.headshot ? w.headshotMult : 1) * e.damageMult;
          this.damage(target, e, dmg, res.headshot, w.knockback * e.knockbackMult);
        }
      }
    }
    if (e.ammo <= 0) this.startReload(e);
  }

  private startReload(e: Entity) {
    if (e.reloading > 0 || e.reserve <= 0) return;
    const w = WEAPONS[e.weapon];
    e.reloading = w.reloadTime;
    const refill = Math.min(w.magazine, e.reserve);
    e.reserve -= refill;
    e.ammo = refill;
  }

  private handleZombieMelee(e: Entity) {
    // Garra automática em zumbis (ataque corpo a corpo em humanos próximos)
    if (e.weapon !== "knife" || e.reloading > 0) return;
    if (e.fireCooldown > 0) return;
    const w = WEAPONS.knife;
    for (const t of this.players) {
      if (!t.alive || t.team === e.team) continue;
      const d = distance(e.pos, t.pos);
      if (d < w.range + BALANCE.playerRadius * 2) {
        e.fireCooldown = 1 / w.fireRate;
        const dmg = (e.classId === "witch" ? 200 : w.dmg) * e.damageMult;
        this.damage(t, e, dmg, false, w.knockback * e.knockbackMult);
        return;
      }
    }
  }

  damage(target: Entity, source: Entity, baseDmg: number, headshot: boolean, knockback: number) {
    if (!target.alive) return;
    if (target.spawnProtectUntil > now()) return;
    // Nemesis resistente a dano (zp_zombie_damage x0.75 + defesa do boss)
    let dmg = baseDmg;
    if (target.team === "zombie" && !target.isBoss) dmg *= BALANCE.zombieDefenseMult;
    if (target.isBoss && target.team === "zombie") dmg *= 0.5;

    // Armadura absorve 40%
    let absorbed = 0;
    if (target.armor > 0) {
      absorbed = Math.min(target.armor, dmg * 0.4);
      target.armor -= absorbed;
      dmg -= absorbed;
    }
    target.hp -= dmg;
    target.lastHitBy = source.id;
    target.lastHitAt = now();
    // Knockback — empurra no vetor source->target
    const dx = target.pos.x - source.pos.x;
    const dz = target.pos.z - source.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const kb = knockback * BALANCE.knockbackPower * target.knockbackMult;
    target.vel.x += (dx / len) * kb;
    target.vel.z += (dz / len) * kb;

    // Recompensa de dano: 1 AP / 500 de dano
    if (source.team === "human" && !source.isBot) {
      const gain = Math.floor(dmg / BALANCE.apDamageDiv);
      if (gain > 0) this.addAp(source.id, gain);
    }

    this.fx.push({ kind: "damage", pos: { ...target.pos, y: target.pos.y + 1.2 }, color: 0xff5252, value: Math.round(dmg) });

    if (target.hp <= 0) {
      this.killEntity(target, source, headshot);
    }
  }

  killEntity(target: Entity, source: Entity, headshot: boolean) {
    target.alive = false;
    target.deaths++;
    source.kills++;
    source.streak++;

    // Drop físico de ammo pack ao matar zumbi (zp50_drop_ammopacks)
    if (target.team === "zombie") {
      this.dropAmmoPack({ x: target.pos.x, y: 0, z: target.pos.z });
    }

    // Streak labels
    let streakLabel: string | undefined;
    for (const s of STREAKS) {
      if (source.streak === s.kills) streakLabel = s.label;
    }

    this.kills.push({
      killer: source.name,
      victim: target.name,
      weapon: WEAPONS[source.weapon]?.name ?? "Garra",
      headshot,
      streak: source.streak,
      streakLabel,
    });
    this.broadcast({ t: "kill", d: this.kills[this.kills.length - 1] });

    // Recompensas
    if (!source.isBot) {
      const apGain = target.team === "zombie" ? BALANCE.apKillZombie : BALANCE.apKillHuman;
      this.addAp(source.id, apGain);
    }

    // Boomer explode ao morrer
    if (target.classId === "boomer") {
      this.explodeAt(target.pos, 4.5, 40, target.team, source);
    }

    // Infecção: humano morto vira zumbi (exceto swarm/armageddon)
    const canInfect = this.round.mode !== "swarm" && this.round.mode !== "armageddon";
    if (target.team === "human" && canInfect) {
      this.infect(target, source, false);
      this.broadcastChat(`${target.name} se juntou à horda.`, true, 0x00e676);
    }
    // Respawn com delay (deathmatch 5s)
    target.respawnAt = now() + 5;
    if (!target.isBot) {
      this.sendTo(target.id, { t: "self", d: this.selfState(target) });
    }

    // Se o alvo era humano vivo restante, checar round end
    this.countTeams();
  }

  infect(target: Entity, source: Entity | null, first: boolean) {
    target.team = "zombie";
    this.applyClass(target, "classic");
    target.weapon = "knife";
    target.isBoss = false;
    if (source) {
      source.infections++;
      if (!source.isBot) this.addAp(source.id, BALANCE.apInfect);
      this.broadcastChat(SYS.infection(source.name, target.name), true);
    }
    if (!target.isBot) {
      this.sendTo(target.id, { t: "self", d: this.selfState(target) });
    }
    // Fúria do primeiro zumbi
    if (first) {
      target.buffSpeed = BALANCE.firstZombieFurySpeed;
      target.buffSpeedUntil = now() + 10;
      target.damageMult = BALANCE.firstZombieFuryDamage;
      target.buffDamageUntil = now() + 10;
    }
    this.fx.push({ kind: "infect", pos: { ...target.pos, y: target.pos.y + 1 }, color: 0x00e676 });
    this.countTeams();
  }

  private explodeAt(pos: Vec3, radius: number, dmg: number, team: Team, source: Entity) {
    this.fx.push({ kind: "explosion", pos, color: 0xff6d00, value: radius });
    for (const p of this.players) {
      if (!p.alive || p.team === team) continue;
      const d = distance(p.pos, pos);
      if (d < radius) {
        const falloff = 1 - d / radius;
        this.damage(p, source, dmg * falloff, false, 6 * falloff);
      }
    }
  }

  // ===== Habilidades (R) =====

  useAbility(e: Entity) {
    if (e.abilityCooldown > 0 || !e.alive) return;
    const c = e.cls;
    if (c.abilityCooldown <= 0 && e.team === "zombie" && e.classId === "boomer") return; // passiva
    e.abilityCooldown = c.abilityCooldown;

    const eye = { x: e.pos.x, y: e.pos.y + BALANCE.eyeHeight * e.scale, z: e.pos.z };
    const fwd = {
      x: -Math.sin(e.yaw) * Math.cos(e.pitch),
      y: Math.sin(e.pitch),
      z: -Math.cos(e.yaw) * Math.cos(e.pitch),
    };

    switch (e.classId) {
      // ===== Zumbis =====
      case "runner": {
        e.buffSpeed = 1.5;
        e.buffSpeedUntil = now() + 3;
        this.fx.push({ kind: "speed", pos: e.pos, color: 0xffb300 });
        break;
      }
      case "tank": {
        // Salto devastador
        e.vel.y = BALANCE.jumpVel * 2.2;
        e.vel.x = fwd.x * 14;
        e.vel.z = fwd.z * 14;
        this.fx.push({ kind: "leap", pos: e.pos, color: 0x8d6e63 });
        break;
      }
      case "smoker": {
        // Língua: puxa humano mirado com LOS até 800u
        const target = this.raycastPlayers(e, 800);
        if (target) {
          this.fx.push({ kind: "tongue", pos: target.pos, color: 0x7cb342, value: e.id });
          target.vel.x = (e.pos.x - target.pos.x) * 3;
          target.vel.z = (e.pos.z - target.pos.z) * 3;
        }
        break;
      }
      case "spitter": {
        this.projectiles.push({
          id: this.nextProjId++,
          kind: "acid",
          pos: { ...eye },
          vel: { x: fwd.x * 22, y: fwd.y * 22 + 3, z: fwd.z * 22 },
          owner: e.id,
          ttl: 2,
        });
        break;
      }
      case "witch": {
        // Garra letal na mira
        const target = this.raycastPlayers(e, 3.5);
        if (target) {
          this.damage(target, e, 200, false, 3);
        }
        break;
      }
      case "nemesis": {
        e.vel.y = BALANCE.jumpVel * 2.4;
        e.vel.x = fwd.x * 18;
        e.vel.z = fwd.z * 18;
        this.fx.push({ kind: "leap", pos: e.pos, color: 0xff1744 });
        break;
      }
      // ===== Humanos =====
      case "assault": {
        // Granada de fogo (projétil)
        this.projectiles.push({
          id: this.nextProjId++,
          kind: "fire_grenade",
          pos: { ...eye },
          vel: { x: fwd.x * 20, y: fwd.y * 20 + 5, z: fwd.z * 20 },
          owner: e.id,
          ttl: 3,
        });
        break;
      }
      case "medic": {
        // Cura área 300u — 50 HP
        for (const p of this.players) {
          if (!p.alive || p.team !== "human") continue;
          if (distance(p.pos, e.pos) < 6) {
            p.hp = Math.min(p.maxHp, p.hp + 50);
            this.fx.push({ kind: "heal", pos: p.pos, color: 0x00e676 });
          }
        }
        break;
      }
      case "heavy": {
        e.buffSpeed = 1.5;
        e.buffSpeedUntil = now() + 5;
        this.fx.push({ kind: "speed", pos: e.pos, color: 0xef5350 });
        break;
      }
      case "ghost": {
        e.invisibleUntil = now() + 5;
        this.fx.push({ kind: "invisible", pos: e.pos, color: 0xcfd8dc });
        break;
      }
      case "doomslayer": {
        e.buffSpeed = 1.6;
        e.buffSpeedUntil = now() + 4;
        e.damageMult = 2;
        e.buffDamageUntil = now() + 4;
        this.fx.push({ kind: "speed", pos: e.pos, color: 0xb71c1c });
        break;
      }
    }
  }

  private raycastPlayers(e: Entity, range: number): Entity | null {
    const eye = { x: e.pos.x, y: e.pos.y + BALANCE.eyeHeight * e.scale, z: e.pos.z };
    let best: Entity | null = null;
    let bestD = range;
    for (const p of this.players) {
      if (!p.alive || p.id === e.id || p.team === e.team) continue;
      const d = distance(eye, p.pos);
      if (d < bestD && lineOfSight(eye, { x: p.pos.x, y: p.pos.y + 1, z: p.pos.z }, MAP.boxes)) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  // ===== Itens (B) =====

  buyItem(e: Entity, itemId: string) {
    const item = ITEM_INDEX[itemId];
    if (!item) return;
    if (item.side !== "both" && item.side !== e.team) return;
    const ap = this.getAp(e.id);
    if (ap < item.cost) {
      this.sendTo(e.id, { t: "error", d: SYS.notEnoughAp() });
      return;
    }
    const owned = this.owned.get(e.id)!;
    if (owned.has(itemId)) {
      this.sendTo(e.id, { t: "error", d: "Item já comprado neste round." });
      return;
    }
    owned.add(itemId);
    this.ap.set(e.id, ap - item.cost);
    this.applyItem(e, itemId);
    this.sendTo(e.id, { t: "shop", d: { ap: this.getAp(e.id), owned: [...owned] } });
    this.sendTo(e.id, { t: "chat", d: { name: "A PRAGA", text: SYS.bought(item.name, item.cost), system: true, color: 0xffee58 } });
  }

  private applyItem(e: Entity, itemId: string) {
    switch (itemId) {
      case "adrenaline":
        e.buffSpeed = 1.4;
        e.buffSpeedUntil = now() + 8;
        break;
      case "medkit":
        e.hp = Math.min(e.maxHp, e.hp + 60);
        break;
      case "fire_grenade":
        this.throwGrenade(e, "fire_grenade");
        break;
      case "frost_grenade":
        this.throwGrenade(e, "frost_grenade");
        break;
      case "pipebomb":
        this.throwGrenade(e, "pipebomb");
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
        const fwd = {
          x: -Math.sin(e.yaw) * Math.cos(e.pitch),
          y: 0,
          z: -Math.cos(e.yaw) * Math.cos(e.pitch),
        };
        e.vel.x = fwd.x * 22;
        e.vel.z = fwd.z * 22;
        e.vel.y = 6;
        break;
      }
    }
  }

  private throwGrenade(e: Entity, kind: string) {
    const eye = { x: e.pos.x, y: e.pos.y + BALANCE.eyeHeight * e.scale, z: e.pos.z };
    const fwd = {
      x: -Math.sin(e.yaw) * Math.cos(e.pitch),
      y: Math.sin(e.pitch),
      z: -Math.cos(e.yaw) * Math.cos(e.pitch),
    };
    this.projectiles.push({
      id: this.nextProjId++,
      kind,
      pos: { ...eye },
      vel: { x: fwd.x * 24, y: fwd.y * 24 + 6, z: fwd.z * 24 },
      owner: e.id,
      ttl: 4,
    });
  }

  // ===== Projéteis =====

  private updateProjectiles(dt: number) {
    const dead: Projectile[] = [];
    for (const pr of this.projectiles) {
      pr.ttl -= dt;
      // Física simples
      pr.vel.y -= BALANCE.gravity * 0.6 * dt;
      pr.pos.x += pr.vel.x * dt;
      pr.pos.y += pr.vel.y * dt;
      pr.pos.z += pr.vel.z * dt;
      if (pr.pos.y < 0) {
        pr.pos.y = 0;
        pr.vel.y = 0;
      }
      if (pr.ttl <= 0 || pr.pos.y <= 0.01) {
        this.explodeProjectile(pr);
        dead.push(pr);
      }
    }
    this.projectiles = this.projectiles.filter((p) => !dead.includes(p));
  }

  private explodeProjectile(pr: Projectile) {
    const owner = this.players.find((p) => p.id === pr.owner);
    if (!owner) return;
    switch (pr.kind) {
      case "fire_grenade":
        this.explodeAt(pr.pos, 4, 120, owner.team, owner);
        break;
      case "frost_grenade": {
        this.explodeAt(pr.pos, 5, 5, owner.team, owner);
        // Freeze: congela zumbis 3s
        for (const p of this.players) {
          if (!p.alive || p.team === owner.team) continue;
          if (distance(p.pos, pr.pos) < 5) {
            p.input.moveX = 0;
            p.input.moveY = 0;
            p.vel.x = 0;
            p.vel.z = 0;
            p.fireCooldown = 3;
          }
        }
        this.fx.push({ kind: "frost", pos: pr.pos, color: 0x4fc3f7 });
        break;
      }
      case "pipebomb":
        this.explodeAt(pr.pos, 6.5, 300, owner.team, owner);
        break;
      case "acid": {
        this.fx.push({ kind: "acid", pos: pr.pos, color: 0x9ccc65, value: 5 });
        break;
      }
    }
  }

  // ===== Pickups (ammo packs físicos) =====

  private dropAmmoPack(pos: Vec3) {
    this.pickups.push({
      id: this.nextPickupId++,
      kind: "ammopack",
      pos: { ...pos, y: 0.5 },
      value: 10,
      until: this.serverTime + 30,
    });
  }

  private updatePickups() {
    this.pickups = this.pickups.filter((p) => this.serverTime < p.until);
    for (const p of this.players) {
      if (!p.alive) continue;
      for (const pk of this.pickups) {
        if (distance(p.pos, pk.pos) < 1.6) {
          pk.until = 0;
          if (!p.isBot) {
            this.addAp(p.id, pk.value);
            this.sendTo(p.id, { t: "chat", d: { name: "A PRAGA", text: SYS.ammoPicked(pk.value), system: true, color: 0x00e676 } });
          }
          this.fx.push({ kind: "pickup", pos: pk.pos, color: 0x00e676 });
          break;
        }
      }
    }
    this.pickups = this.pickups.filter((p) => this.serverTime < p.until);
  }

  // ===== Round end check =====

  private checkRoundEnd() {
    if (this.round.phase !== "hunt" && this.round.phase !== "last_human") return;
    const humans = this.players.filter((p) => p.alive && p.team === "human");
    const zombies = this.players.filter((p) => p.alive && p.team === "zombie");

    // Transição para "último humano"
    if (humans.length === 1 && zombies.length > 0 && this.round.phase !== "last_human") {
      this.round.phase = "last_human";
      const h = humans[0];
      // Bônus de herói
      h.maxHp = Math.max(h.maxHp, h.hp + BALANCE.lastHumanBonusHp);
      this.broadcastChat(`❤️ ${narrate("last_human", h.name)}`);
      this.broadcast({ t: "roundStart", d: { ...this.round } });
    }
    if (zombies.length === 1 && humans.length > 0 && this.round.phase === "hunt") {
      this.broadcastChat(`☠️ ${narrate("last_zombie", zombies[0].name)}`);
    }

    switch (this.round.mode) {
      case "swarm":
      case "armageddon":
        if (humans.length === 0) this.endRound("zombie", "Humanos eliminados");
        else if (zombies.length === 0) this.endRound("human", "Zumbis eliminados");
        break;
      case "nemesis": {
        const nem = this.players.find((p) => p.isBoss && p.team === "zombie" && p.alive);
        if (!nem) this.endRound("human", "NEMESIS foi derrotado");
        else if (humans.length === 0) this.endRound("zombie", "Todos os humanos caíram");
        break;
      }
      case "survivor": {
        const surv = this.players.find((p) => p.isBoss && p.team === "human" && p.alive);
        if (!surv) this.endRound("zombie", "SURVIVOR caiu");
        else if (zombies.length === 0) this.endRound("human", "A horda foi exterminada");
        break;
      }
      default:
        if (humans.length === 0) this.endRound("zombie", "Todos infectados");
        else if (zombies.length === 0) this.endRound("human", "Horda exterminada");
    }
  }

  private countTeams() {
    this.round.zombies = this.players.filter((p) => p.alive && p.team === "zombie").length;
    this.round.humans = this.players.filter((p) => p.alive && p.team === "human").length;
  }

  // ===== Input / ações de clientes =====

  handleInput(id: number, input: InputState) {
    const e = this.players.find((p) => p.id === id);
    if (!e || !e.alive) return;
    const ability = input.ability && !e.input.ability;
    e.input = input;
    e.yaw = input.yaw;
    e.pitch = input.pitch;
    if (ability) this.useAbility(e);
  }

  handleChat(id: number, text: string) {
    const e = this.players.find((p) => p.id === id);
    if (!e || !text.trim()) return;
    const clean = text.trim().slice(0, 140);
    this.broadcastChat(`${e.name}: ${clean}`);
  }

  handleSelectClass(id: number, classId: string) {
    const e = this.players.find((p) => p.id === id);
    if (!e) return;
    const def = CLASS_INDEX[classId];
    if (!def || def.side !== e.team) return;
    e.preferredClass = classId;
    this.applyClass(e, classId);
    if (e.team === "human" && def.weapon) {
      e.weapon = def.weapon;
      const w = WEAPONS[def.weapon];
      e.ammo = w.magazine;
      e.reserve = w.reserve;
    }
    this.sendTo(id, { t: "self", d: this.selfState(e) });
  }

  // ===== Snapshot =====

  snapshot(): ServerSnapshot {
    const round: RoundInfo = {
      ...this.round,
      zombies: this.round.zombies,
      humans: this.round.humans,
    };
    return {
      t: this.serverTime,
      players: this.players.map((p) => this.playerState(p)),
      pickups: this.pickups.map((p): PickupState => ({ id: p.id, kind: p.kind, pos: p.pos, value: p.value })),
      projectiles: this.projectiles.map((p): ProjectileState => ({ id: p.id, kind: p.kind, pos: p.pos, vel: p.vel, owner: p.owner })),
      round,
      serverTime: this.serverTime,
    };
  }

  private playerState(e: Entity): PlayerState {
    return {
      id: e.id,
      name: e.name,
      team: e.team,
      classId: e.classId,
      pos: e.pos,
      yaw: e.yaw,
      pitch: e.pitch,
      hp: Math.max(0, Math.round(e.hp)),
      maxHp: e.maxHp,
      alive: e.alive,
      speedMult: e.speedMult,
      scale: e.scale,
      color: e.cls.color,
      isBoss: e.isBoss,
      weapon: e.weapon,
      abilityReady: e.abilityCooldown <= 0,
      ammo: e.ammo,
      reserve: e.reserve,
      kills: e.kills,
      infections: e.infections,
      deaths: e.deaths,
      streak: e.streak,
      armor: Math.round(e.armor),
    };
  }

  private selfState(e: Entity): PlayerState {
    return this.playerState(e);
  }

  private getAp(id: number): number {
    return this.ap.get(id) ?? 0;
  }

  private addAp(id: number, v: number) {
    this.ap.set(id, this.getAp(id) + v);
    this.sendTo(id, { t: "shop", d: { ap: this.getAp(id), owned: [...this.owned.get(id)!] } });
  }

  // ===== Broadcast =====

  private broadcast(msg: unknown) {
    for (const ctx of this.clients.values()) ctx.send(msg);
  }

  private sendTo(id: number, msg: unknown) {
    const ctx = this.clients.get(id);
    if (ctx) ctx.send(msg);
  }

  private broadcastChat(text: string, system = false, color?: number) {
    const m: ChatMessage = { name: "A PRAGA", text, system, color };
    this.chats.push(m);
    if (this.chats.length > 60) this.chats.shift();
    this.broadcast({ t: "chat", d: m });
  }

  drainEvents() {
    const fx = this.fx;
    this.fx = [];
    const kills = this.kills;
    this.kills = [];
    return { fx, kills };
  }
}
