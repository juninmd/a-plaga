import { MAP, resolveCollision, raycastMap, type Aabb } from "../shared/map.js";
import type { Vec3, WeaponSlot } from "../shared/protocol.js";
import { BALANCE, type ClassDef } from "../shared/balance.js";
import { WEAPONS } from "../shared/weapons.js";

export interface SlotState {
  id: string;
  ammo: number;
  reserve: number;
}

export interface BotState {
  strafeDir: number;
  strafeUntil: number;
  targetId: number;
  flee: boolean;
  lastX?: number;
  lastZ?: number;
  stuck?: boolean;
  lastTargetDist?: number;
  lastTargetAt?: number;
  path?: Vec3[];
  pathAt?: number;
  pathGoal?: string;
  lastKnown?: Vec3 | null;
  patrolIdx?: number;
  boughtAt?: number;
}

export interface Entity {
  id: number;
  name: string;
  isBot: boolean;
  team: "human" | "zombie";
  classId: string;
  cls: ClassDef;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  armor: number;
  alive: boolean;
  onGround: boolean;
  crouching: boolean;
  speedMult: number;
  gravityMult: number;
  knockbackMult: number;
  damageMult: number;
  /** Arma atual (id em WEAPONS). ammo/reserve espelham o slot atual. */
  weapon: string;
  ammo: number;
  reserve: number;
  slot: WeaponSlot;
  loadout: Record<WeaponSlot, SlotState | null>;
  preferredPrimary: string;
  preferredSecondary: string;
  fireCooldown: number;
  attackHeld: boolean;
  reloading: number;
  recoilAccum: number;
  abilityCooldown: number;
  buffSpeed: number;
  buffSpeedUntil: number;
  buffDamageUntil: number;
  invisibleUntil: number;
  frozenUntil: number;
  spawnProtectUntil: number;
  respawnAt: number;
  scale: number;
  isBoss: boolean;
  kills: number;
  infections: number;
  deaths: number;
  streak: number;
  lastHitBy: number;
  lastHitAt: number;
  preferredClass: string;
  botState: BotState | null;
  input: {
    moveX: number;
    moveY: number;
    jump: boolean;
    crouch: boolean;
    attack: boolean;
    ability: boolean;
    zoom: boolean;
    yaw: number;
    pitch: number;
  };
}

export interface ShootResult {
  hit: boolean;
  targetId: number;
  headshot: boolean;
  end: Vec3;
  normal: Vec3 | null;
}

export function emptyInput(yaw = 0): Entity["input"] {
  return { moveX: 0, moveY: 0, jump: false, crouch: false, attack: false, ability: false, zoom: false, yaw, pitch: 0 };
}

export function createEntity(id: number, name: string, cls: ClassDef, team: "human" | "zombie", isBot: boolean): Entity {
  const hp = cls.hp;
  const e: Entity = {
    id,
    name,
    isBot,
    team,
    classId: cls.id,
    cls,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    hp,
    maxHp: hp,
    armor: cls.armor ?? 0,
    alive: true,
    onGround: true,
    crouching: false,
    speedMult: cls.speed,
    gravityMult: cls.gravity,
    knockbackMult: cls.knockback,
    damageMult: 1,
    weapon: "knife",
    ammo: 0,
    reserve: 0,
    slot: 3,
    loadout: { 1: null, 2: null, 3: { id: "knife", ammo: 1, reserve: 0 } },
    preferredPrimary: cls.weapon ?? "",
    preferredSecondary: cls.secondary ?? "",
    fireCooldown: 0,
    attackHeld: false,
    reloading: 0,
    recoilAccum: 0,
    abilityCooldown: 0,
    buffSpeed: 1,
    buffSpeedUntil: 0,
    buffDamageUntil: 0,
    invisibleUntil: 0,
    frozenUntil: 0,
    spawnProtectUntil: 0,
    respawnAt: 0,
    scale: cls.scale ?? 1,
    isBoss: false,
    kills: 0,
    infections: 0,
    deaths: 0,
    streak: 0,
    lastHitBy: -1,
    lastHitAt: 0,
    preferredClass: "",
    botState: null,
    input: emptyInput(),
  };
  giveLoadout(e);
  return e;
}

// ===== Loadout =====

export function slotState(id: string): SlotState {
  const w = WEAPONS[id];
  return { id, ammo: w.magazine, reserve: w.reserve };
}

/** Monta os slots conforme o time/classe e equipa a arma principal. */
export function giveLoadout(e: Entity, primary?: string, secondary?: string) {
  if (e.team === "zombie") {
    e.loadout = { 1: null, 2: null, 3: slotState("claws") };
    equipSlot(e, 3, true, false);
    return;
  }
  const p = e.cls.lockedWeapon ? e.cls.weapon : primary ?? e.preferredPrimary ?? e.cls.weapon;
  const s = secondary ?? e.preferredSecondary ?? e.cls.secondary;
  e.loadout = {
    1: p && WEAPONS[p]?.slot === 1 ? slotState(p) : null,
    2: s && WEAPONS[s]?.slot === 2 ? slotState(s) : null,
    3: slotState("knife"),
  };
  equipSlot(e, e.loadout[1] ? 1 : e.loadout[2] ? 2 : 3, true, false);
}

export function syncSlot(e: Entity) {
  const s = e.loadout[e.slot];
  if (s) {
    s.ammo = e.ammo;
    s.reserve = e.reserve;
  }
}

/** Equipa um slot. `sync` guarda a munição da arma atual antes (false quando o loadout acabou de ser trocado). */
export function equipSlot(e: Entity, slot: WeaponSlot, instant = false, sync = true): boolean {
  const s = e.loadout[slot];
  if (!s) return false;
  if (sync) syncSlot(e);
  e.slot = slot;
  e.weapon = s.id;
  e.ammo = s.ammo;
  e.reserve = s.reserve;
  e.reloading = 0;
  e.fireCooldown = instant ? 0 : 0.4;
  return true;
}

const TIME = { value: 0 };

export function setTime(t: number) {
  TIME.value = t;
}

export function now(): number {
  return TIME.value;
}

export function bodyHeight(e: Entity): number {
  return (e.crouching ? BALANCE.crouchHeight : BALANCE.playerHeight) * e.scale;
}

export function eyeHeight(e: Entity): number {
  return (e.crouching ? BALANCE.crouchEyeHeight : BALANCE.eyeHeight) * e.scale;
}

export function eyePos(e: Entity): Vec3 {
  return { x: e.pos.x, y: e.pos.y + eyeHeight(e), z: e.pos.z };
}

export function horizontalSpeed(e: Entity): number {
  return Math.hypot(e.vel.x, e.vel.z);
}

// ===== Movimento (server-authoritative, 20Hz) =====

export function moveEntity(e: Entity, dt: number) {
  const frozen = e.frozenUntil > now();
  const input = frozen ? { ...e.input, moveX: 0, moveY: 0, jump: false } : e.input;

  // Agachar: só levanta se a cabeça couber
  if (input.crouch) e.crouching = true;
  else if (e.crouching) {
    const probe = { ...e.pos };
    const pv = { x: 0, y: 0, z: 0 };
    const blocked = resolveCollision(probe, pv, BALANCE.playerRadius * e.scale, MAP.boxes, BALANCE.playerHeight * e.scale) && probe.y < e.pos.y - 0.01;
    if (!blocked) e.crouching = false;
  }

  const sin = Math.sin(e.yaw);
  const cos = Math.cos(e.yaw);
  const fx = -sin * input.moveY + cos * input.moveX;
  const fz = -cos * input.moveY - sin * input.moveX;
  const len = Math.hypot(fx, fz) || 1;
  const speedBoost = e.buffSpeedUntil > now() ? e.buffSpeed : 1;
  const crouchMult = e.crouching ? BALANCE.crouchSpeedMult : 1;
  const speed = BALANCE.baseSpeed * e.speedMult * speedBoost * crouchMult;
  const targetVx = (fx / len) * speed;
  const targetVz = (fz / len) * speed;
  const accel = e.onGround ? 60 : 8;
  e.vel.x += (targetVx - e.vel.x) * Math.min(1, accel * dt);
  e.vel.z += (targetVz - e.vel.z) * Math.min(1, accel * dt);

  if (input.jump && e.onGround && !e.crouching) {
    e.vel.y = BALANCE.jumpVel / Math.sqrt(e.gravityMult);
  }
  e.vel.y -= BALANCE.gravity * e.gravityMult * dt;
  if (e.vel.y < -30) e.vel.y = -30;

  e.pos.x += e.vel.x * dt;
  e.pos.y += e.vel.y * dt;
  e.pos.z += e.vel.z * dt;

  const wasAbove = e.pos.y > 0.05;
  const hit = resolveCollision(e.pos, e.vel, BALANCE.playerRadius * e.scale, MAP.boxes, bodyHeight(e));
  e.onGround = e.pos.y <= 0.01 || (wasAbove && hit && e.vel.y <= 0);
  if (e.onGround) e.vel.y = 0;
}

// ===== Raycast de tiro: cabeça, corpo, mapa =====

export function shootRay(origin: Vec3, dir: Vec3, players: Entity[], excludeId: number, range: number): ShootResult {
  const dLen = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir = { x: dir.x / dLen, y: dir.y / dLen, z: dir.z / dLen };

  const mapHit = raycastMap(origin, dir, MAP.boxes);
  const maxT = mapHit ? Math.min(range, mapHit.t - 0.05) : range;

  let best: { t: number; e: Entity; headshot: boolean } | null = null;
  for (const p of players) {
    if (p.id === excludeId || !p.alive) continue;
    const h = bodyHeight(p);
    const hy = p.pos.y + h - 0.2 * p.scale;
    const hd = sphereRay(p.pos.x, hy, p.pos.z, 0.22 * p.scale, origin, dir);
    if (hd <= maxT && (!best || hd < best.t)) best = { t: hd, e: p, headshot: true };
    const bd = sphereRay(p.pos.x, p.pos.y + h * 0.5, p.pos.z, 0.3 * h, origin, dir);
    if (bd <= maxT && (!best || bd < best.t)) best = { t: bd, e: p, headshot: false };
  }
  const at = (t: number): Vec3 => ({ x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t });
  if (best) return { hit: true, targetId: best.e.id, headshot: best.headshot, end: at(best.t), normal: null };
  if (mapHit && mapHit.t <= range) return { hit: false, targetId: -1, headshot: false, end: at(mapHit.t), normal: mapHit.normal };
  return { hit: false, targetId: -1, headshot: false, end: at(range), normal: null };
}

function sphereRay(cx: number, cy: number, cz: number, r: number, o: Vec3, d: Vec3): number {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  const t1 = -b - sq;
  if (t1 > 0) return t1;
  return -b + sq;
}

export function lineOfSight(a: Vec3, b: Vec3, boxes: Aabb[]): boolean {
  const dir = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= len; dir.y /= len; dir.z /= len;
  const hit = raycastMap(a, dir, boxes);
  if (!hit) return true;
  return hit.t > len - 0.2;
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function lookAtYaw(pos: Vec3, target: Vec3): number {
  return Math.atan2(-(target.x - pos.x), -(target.z - pos.z));
}

/** Vetor unitário para onde a entidade olha (yaw=0 → -z). */
export function forward(e: Entity): Vec3 {
  return {
    x: -Math.sin(e.yaw) * Math.cos(e.pitch),
    y: Math.sin(e.pitch),
    z: -Math.cos(e.yaw) * Math.cos(e.pitch),
  };
}
