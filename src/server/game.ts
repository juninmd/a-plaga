import { BALANCE, CLASS_INDEX, HUMAN_CLASSES, ZOMBIE_CLASSES } from "../shared/balance.js";
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
  WeaponSlot,
} from "../shared/protocol.js";
import { PRIMARY_WEAPONS, RECOIL_DECAY_PER_SEC, WEAPONS } from "../shared/weapons.js";
import { buyItem, dropAmmoPack, updatePickups, updateProjectiles, useAbility } from "./abilities.js";
import { handleAttack, handleMelee, startReload } from "./combat.js";
import {
  createEntity,
  distance,
  emptyInput,
  equipSlot,
  giveLoadout,
  horizontalSpeed,
  moveEntity,
  now,
  setTime,
  syncSlot,
  type Entity,
} from "./physics.js";
import { checkRoundEnd, endRound, startRound } from "./rounds.js";

export interface ClientCtx {
  send(msg: unknown): void;
}

export interface Pickup {
  id: number;
  kind: "ammopack" | "weapon";
  pos: Vec3;
  value: number;
  until: number;
}

export interface Projectile {
  id: number;
  kind: string;
  pos: Vec3;
  vel: Vec3;
  owner: number;
  ttl: number;
}

export interface BotBrain {
  think(e: Entity, game: Game): void;
}

const BOT_TARGET_COUNT = 8;
const SPAWN_OCCUPIED = 2; // metros: ponto já tem alguém em cima
const SPAWN_ENEMY_MIN = 25; // metros: distância mínima de um inimigo ao nascer

function shuffle<T>(list: readonly T[]): T[] {
  return [...list].sort(() => Math.random() - 0.5);
}
const BUY_ZONE_RADIUS = 14;

export class Game {
  players: Entity[] = [];
  clients = new Map<number, ClientCtx>();
  pickups: Pickup[] = [];
  projectiles: Projectile[] = [];
  chats: ChatMessage[] = [];
  kills: KillFeedEntry[] = [];
  fx: FxEvent[] = [];
  round: RoundInfo = { mode: "infection", phase: "countdown", timeLeft: BALANCE.countdownTime, zombies: 0, humans: 0, firstZombie: "", modeLabel: "", number: 0 };
  serverTime = 0;
  roundNumber = 0;
  announcedLastZombie = false;
  lastMode: GameMode | null = null;
  nextId = 1;
  nextPickupId = 1;
  nextProjId = 1;
  ap = new Map<number, number>();
  owned = new Map<number, Set<string>>();
  private botBrain: BotBrain;
  private nextRoundTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(brain?: BotBrain) {
    this.botBrain = brain ?? { think: () => {} };
  }

  // ===== Lifecycle =====

  addPlayer(name: string, ctx: ClientCtx): number {
    const id = this.nextId++;
    const e = createEntity(id, name, HUMAN_CLASSES[0], "human", false);
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
    for (let i = 0; i < need; i++) {
      const zombies = this.players.filter((p) => p.team === "zombie").length;
      const humansCount = this.players.filter((p) => p.team === "human").length;
      const team: Team = humansCount > 2 && zombies < humansCount * 0.8 ? "zombie" : "human";
      const id = this.nextId++;
      const cls = team === "zombie" ? ZOMBIE_CLASSES[Math.floor(Math.random() * ZOMBIE_CLASSES.length)] : HUMAN_CLASSES[0];
      // Nome derivado do id — dois bots com o mesmo nome misturavam o killfeed
      const e = createEntity(id, `Bot_${String.fromCharCode(65 + (id % 26))}${id}`, cls, team, true);
      e.botState = { strafeDir: 1, strafeUntil: 0, targetId: -1, flee: false };
      this.players.push(e);
      this.ap.set(id, BALANCE.apStarting);
      this.owned.set(id, new Set());
      this.spawnAtRandom(e);
    }
  }

  // ===== Spawn / classe =====

  spawnAtRandom(e: Entity) {
    if (!e.isBoss) {
      const pref = CLASS_INDEX[e.preferredClass];
      const want = pref && pref.side === e.team ? pref.id : e.team === "zombie" ? "classic" : "assault";
      if (want !== e.classId) this.applyClass(e, want);
    }
    this.relocate(e);
    e.pitch = 0;
    e.alive = true;
    e.crouching = false;
    e.respawnAt = 0;
    e.hp = e.maxHp;
    e.armor = e.cls.armor ?? 0;
    e.spawnProtectUntil = now() + BALANCE.spawnProtection;
    e.buffSpeed = 1;
    e.buffSpeedUntil = 0;
    e.damageMult = 1;
    e.buffDamageUntil = 0;
    e.invisibleUntil = 0;
    e.frozenUntil = 0;
    e.reloading = 0;
    e.fireCooldown = 0;
    e.recoilAccum = 0;
    e.abilityCooldown = 0;
    e.input = emptyInput(e.yaw);
    if (e.isBot && e.team === "human" && !e.cls.lockedWeapon) {
      e.preferredPrimary = PRIMARY_WEAPONS[Math.floor(Math.random() * PRIMARY_WEAPONS.length)].id;
    }
    giveLoadout(e);
    if (!e.isBot) this.sendTo(e.id, { t: "self", d: this.playerState(e) });
  }

  /**
   * Leva a entidade ao ponto de spawn do seu time mais afastado de todo mundo: ninguém nasce
   * em cima de outro jogador nem com inimigo a menos de SPAWN_ENEMY_MIN metros.
   */
  relocate(e: Entity) {
    const pool = e.team === "zombie" ? MAP.zombieSpawns : MAP.spawns;
    const others = this.players.filter((p) => p !== e && p.alive);
    let best = pool[0];
    let bestScore = -Infinity;
    for (const s of shuffle(pool)) {
      let score = 0;
      for (const o of others) {
        const d = distance(s.pos, o.pos);
        if (d < SPAWN_OCCUPIED) score -= 1000;
        if (o.team !== e.team && d < SPAWN_ENEMY_MIN) score -= 100 * (SPAWN_ENEMY_MIN - d);
        score += Math.min(d, 30) * (o.team === e.team ? 0.2 : 1);
      }
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    e.pos = { x: best.pos.x, y: 0, z: best.pos.z };
    e.yaw = best.yaw;
    e.vel = { x: 0, y: 0, z: 0 };
  }

  applyClass(e: Entity, classId: string) {
    const def = CLASS_INDEX[classId];
    if (!def || e.team !== def.side) return;
    e.cls = def;
    e.classId = def.id;
    e.maxHp = def.hp;
    e.hp = def.hp;
    e.speedMult = def.speed;
    e.gravityMult = def.gravity;
    e.knockbackMult = def.knockback;
    e.scale = def.scale ?? 1;
    e.armor = def.armor ?? e.armor;
    if (e.team === "human" && (def.lockedWeapon || !e.preferredPrimary)) e.preferredPrimary = def.weapon ?? "";
    if (e.team === "human" && !e.preferredSecondary) e.preferredSecondary = def.secondary ?? "";
    giveLoadout(e);
  }

  // ===== Round =====

  startRound() {
    startRound(this);
  }

  scheduleNextRound(ms: number) {
    if (this.nextRoundTimer) clearTimeout(this.nextRoundTimer);
    this.nextRoundTimer = setTimeout(() => {
      this.nextRoundTimer = null;
      this.startRound();
    }, ms);
  }

  // ===== Tick =====

  tick(dt: number) {
    setTime(this.serverTime);
    if (this.round.phase === "countdown") {
      this.round.timeLeft -= dt;
      updatePickups(this);
      this.countTeams();
      if (this.round.timeLeft <= 0) {
        this.round.phase = "hunt";
        this.round.timeLeft = BALANCE.roundTime;
        this.broadcast({ t: "roundStart", d: { ...this.round } });
      }
    } else if (this.round.phase === "hunt" || this.round.phase === "last_human") {
      this.round.timeLeft -= dt;
      this.updatePlayers(dt);
      updateProjectiles(this, dt);
      updatePickups(this);
      this.countTeams();
      checkRoundEnd(this);
      if (this.round.timeLeft <= 0 && (this.round.phase as string) !== "over") {
        endRound(this, "human", "Tempo esgotado — humanos sobreviveram");
      }
    } else {
      this.pickups = this.pickups.filter((p) => this.serverTime < p.until);
    }
    this.serverTime += dt;
  }

  private updatePlayers(dt: number) {
    const SUB = 4;
    const subDt = dt / SUB;
    for (const e of this.players) {
      if (!e.alive) {
        if (e.respawnAt > 0 && now() >= e.respawnAt && this.round.phase === "hunt") this.spawnAtRandom(e);
        continue;
      }
      if (e.buffDamageUntil > 0 && now() >= e.buffDamageUntil) {
        e.damageMult = 1;
        e.buffDamageUntil = 0;
      }
      if (e.buffSpeedUntil > 0 && now() >= e.buffSpeedUntil) {
        e.buffSpeed = 1;
        e.buffSpeedUntil = 0;
      }
      const frozen = e.frozenUntil > now();
      if (e.isBot && !frozen) this.botBrain.think(e, this);
      if (frozen) {
        e.input.moveX = 0;
        e.input.moveY = 0;
        e.input.jump = false;
        e.input.attack = false;
      }
      // Sub-passos: evita atravessar alvos entre ticks
      for (let s = 0; s < SUB; s++) {
        moveEntity(e, subDt);
        handleAttack(this, e);
        handleMelee(this, e);
      }
      e.attackHeld = e.input.attack;
      if (e.reloading > 0) e.reloading -= dt;
      if (e.fireCooldown > 0) e.fireCooldown -= dt;
      if (e.abilityCooldown > 0) e.abilityCooldown -= dt;
      e.recoilAccum = Math.max(0, e.recoilAccum - RECOIL_DECAY_PER_SEC * dt);
    }
  }

  countTeams() {
    this.round.zombies = this.players.filter((p) => p.alive && p.team === "zombie").length;
    this.round.humans = this.players.filter((p) => p.alive && p.team === "human").length;
  }

  // ===== Ações de clientes =====

  handleInput(id: number, raw: InputState) {
    const e = this.players.find((p) => p.id === id);
    if (!e) return;
    // Cliente não é confiável: NaN/Infinity em yaw ou moveX contaminam a posição para sempre
    const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
    const input: InputState = {
      moveX: num(raw.moveX, -1, 1),
      moveY: num(raw.moveY, -1, 1),
      yaw: num(raw.yaw, -1e6, 1e6),
      pitch: num(raw.pitch, -1.5, 1.5),
      jump: raw.jump === true,
      crouch: raw.crouch === true,
      attack: raw.attack === true,
      ability: raw.ability === true,
      zoom: raw.zoom === true,
    };
    e.yaw = input.yaw;
    e.pitch = input.pitch;
    if (!e.alive) {
      e.input = { ...input, moveX: 0, moveY: 0, jump: false, attack: false, ability: false };
      return;
    }
    const ability = input.ability && !e.input.ability;
    e.input = { ...input };
    if (ability) useAbility(this, e);
  }

  useAbility(e: Entity) {
    useAbility(this, e);
  }

  buyItem(e: Entity, itemId: string) {
    buyItem(this, e, itemId);
  }

  handleReload(id: number) {
    const e = this.players.find((p) => p.id === id);
    if (e && e.alive) startReload(e);
  }

  handleSwitch(id: number, slot: WeaponSlot) {
    const e = this.players.find((p) => p.id === id);
    if (!e || !e.alive || slot === e.slot) return;
    if (equipSlot(e, slot)) this.sendTo(id, { t: "self", d: this.playerState(e) });
  }

  inBuyZone(e: Entity): boolean {
    if (this.round.phase === "countdown" || e.spawnProtectUntil > now()) return true;
    return MAP.spawns.some((s) => distance(s.pos, e.pos) < BUY_ZONE_RADIUS);
  }

  handleBuyWeapon(id: number, weaponId: string) {
    const e = this.players.find((p) => p.id === id);
    if (!e || !e.alive || e.team !== "human") return;
    const w = WEAPONS[weaponId];
    if (!w || (w.slot !== 1 && w.slot !== 2)) return;
    if (w.slot === 1 && e.cls.lockedWeapon) {
      this.sendTo(id, { t: "error", d: `${e.cls.name} não troca a primária.` });
      return;
    }
    if (!this.inBuyZone(e)) {
      this.sendTo(id, { t: "error", d: "Só dá pra comprar no spawn." });
      return;
    }
    if (w.slot === 1) e.preferredPrimary = weaponId;
    else e.preferredSecondary = weaponId;
    syncSlot(e);
    e.loadout[w.slot] = { id: weaponId, ammo: w.magazine, reserve: w.reserve };
    equipSlot(e, w.slot, false, false);
    this.sendTo(id, { t: "self", d: this.playerState(e) });
  }

  handleChat(id: number, text: string) {
    const e = this.players.find((p) => p.id === id);
    if (!e || typeof text !== "string" || !text.trim()) return;
    this.broadcastChat(`${e.name}: ${text.trim().slice(0, 140)}`);
  }

  handleSelectClass(id: number, classId: string) {
    const e = this.players.find((p) => p.id === id);
    if (!e) return;
    const def = CLASS_INDEX[classId];
    if (!def || def.side !== e.team) return;
    if (def.id === "nemesis" || def.id === "survivor") return;
    e.preferredClass = classId;
    // Trocar de classe no meio do tiroteio curava 100% — só vale no respawn
    const canApplyNow = !e.alive || this.round.phase === "countdown" || e.spawnProtectUntil > now();
    if (canApplyNow && !e.isBoss) {
      this.applyClass(e, classId);
    } else {
      this.sendTo(id, { t: "chat", d: { name: "A PRAGA", text: `${def.name} escolhido — entra em vigor no próximo respawn.`, system: true, color: 0xffee58 } });
    }
    this.sendTo(id, { t: "self", d: this.playerState(e) });
  }

  dropAmmoPack(pos: Vec3) {
    dropAmmoPack(this, pos);
  }

  // ===== Snapshot =====

  snapshot(): ServerSnapshot {
    return {
      t: this.serverTime,
      players: this.players.map((p) => this.playerState(p)),
      pickups: this.pickups.map((p): PickupState => ({ id: p.id, kind: p.kind, pos: p.pos, value: p.value })),
      projectiles: this.projectiles.map((p): ProjectileState => ({ id: p.id, kind: p.kind, pos: p.pos, vel: p.vel, owner: p.owner })),
      round: { ...this.round },
      serverTime: this.serverTime,
    };
  }

  playerState(e: Entity): PlayerState {
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
      invisible: e.invisibleUntil > now(),
      reloading: e.reloading > 0,
      crouching: e.crouching,
      speed: Math.round(horizontalSpeed(e) * 100) / 100,
      vel: e.vel,
      slots: [e.loadout[1]?.id ?? null, e.loadout[2]?.id ?? null, e.loadout[3]?.id ?? null],
    };
  }

  getAp(id: number): number {
    return this.ap.get(id) ?? 0;
  }

  addAp(id: number, v: number) {
    this.ap.set(id, this.getAp(id) + v);
    this.sendTo(id, { t: "shop", d: { ap: this.getAp(id), owned: [...(this.owned.get(id) ?? [])] } });
  }

  // ===== Broadcast =====

  broadcast(msg: unknown) {
    for (const ctx of this.clients.values()) ctx.send(msg);
  }

  sendTo(id: number, msg: unknown) {
    this.clients.get(id)?.send(msg);
  }

  broadcastChat(text: string, system = false, color?: number) {
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
