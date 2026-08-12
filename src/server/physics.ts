import { MAP, resolveCollision, raycastMap, type Aabb } from "../shared/map.js";
import type { Vec3 } from "../shared/protocol.js";
import { BALANCE, type ClassDef } from "../shared/balance.js";

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
  speedMult: number;
  gravityMult: number;
  knockbackMult: number;
  damageMult: number;
  weapon: string;
  ammo: number;
  reserve: number;
  fireCooldown: number;
  reloading: number;
  abilityCooldown: number;
  buffSpeed: number;
  buffSpeedUntil: number;
  buffDamageUntil: number;
  invisibleUntil: number;
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
  // bot AI
  botState: {
    strafeDir: number;
    strafeUntil: number;
    targetId: number;
    flee: boolean;
    lastX?: number;
    lastZ?: number;
    lastMoveAt?: number;
    stuck?: boolean;
    lastTargetDist?: number;
    lastTargetAt?: number;
  } | null;
  // input (humanos via ws)
  input: { moveX: number; moveY: number; jump: boolean; attack: boolean; ability: boolean; yaw: number; pitch: number };
}

export interface ShootResult {
  hit: boolean;
  targetId: number;
  headshot: boolean;
  end: Vec3;
  dmg: number;
}

export function createEntity(id: number, name: string, cls: ClassDef, team: "human" | "zombie", isBot: boolean): Entity {
  const hp = cls.hp;
  return {
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
    speedMult: cls.speed,
    gravityMult: cls.gravity,
    knockbackMult: cls.knockback,
    damageMult: 1,
    weapon: cls.weapon ?? "knife",
    ammo: 0,
    reserve: 0,
    fireCooldown: 0,
    reloading: 0,
    abilityCooldown: 0,
    buffSpeed: 1,
    buffSpeedUntil: 0,
    buffDamageUntil: 0,
    invisibleUntil: 0,
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
    input: { moveX: 0, moveY: 0, jump: false, attack: false, ability: false, yaw: 0, pitch: 0 },
  };
}

const TIME = { value: 0 };

export function setTime(t: number) {
  TIME.value = t;
}

export function now(): number {
  return TIME.value;
}

// ===== Movimento (server-authoritative, 20Hz) =====

export function moveEntity(e: Entity, dt: number) {
  const input = e.input;
  // Direção relativa ao yaw
  const sin = Math.sin(e.yaw);
  const cos = Math.cos(e.yaw);
  let fx = 0;
  let fz = 0;
  if (e.team === "human") {
    fx = -sin * input.moveY + cos * input.moveX;
    fz = -cos * input.moveY - sin * input.moveX;
  } else {
    // zumbi: moveY é "frente" (IA) ou input
    fx = -sin * input.moveY + cos * input.moveX;
    fz = -cos * input.moveY - sin * input.moveX;
  }
  const len = Math.hypot(fx, fz) || 1;
  const speedBoost = e.buffSpeedUntil > now() ? e.buffSpeed : 1;
  const speed = BALANCE.baseSpeed * e.speedMult * speedBoost;
  const targetVx = (fx / len) * speed;
  const targetVz = (fz / len) * speed;
  // Aceleração rápida (responsivo)
  const accel = 60;
  e.vel.x += (targetVx - e.vel.x) * Math.min(1, accel * dt);
  e.vel.z += (targetVz - e.vel.z) * Math.min(1, accel * dt);

  // Gravidade / pulo
  if (input.jump && e.onGround) {
    e.vel.y = BALANCE.jumpVel / Math.sqrt(e.gravityMult);
  }
  e.vel.y -= BALANCE.gravity * e.gravityMult * dt;
  if (e.vel.y < -30) e.vel.y = -30;

  e.pos.x += e.vel.x * dt;
  e.pos.y += e.vel.y * dt;
  e.pos.z += e.vel.z * dt;

  const wasAbove = e.pos.y > 0.05;
  const hit = resolveCollision(e.pos, e.vel, BALANCE.playerRadius * e.scale, MAP.boxes);
  e.onGround = e.pos.y <= 0.01 || (wasAbove && hit && e.vel.y <= 0);

  if (e.onGround) e.vel.y = 0;
}

// ===== Raycast de tiro: primeiro contra cabeças, depois corpos, depois mapa =====

export function shootRay(origin: Vec3, dir: Vec3, players: Entity[], excludeId: number, range: number): ShootResult {
  const d = { x: dir.x, y: dir.y, z: dir.z };
  const dLen = Math.hypot(d.x, d.y, d.z) || 1;
  dir = { x: d.x / dLen, y: d.y / dLen, z: d.z / dLen };

  // Hit do mapa primeiro — limita o alcance do tiro
  const mapHit = raycastMap(origin, dir, MAP.boxes);
  const maxT = mapHit ? Math.min(range, mapHit.t - 0.05) : range;

  const hits: { t: number; e: Entity; headshot: boolean }[] = [];
  for (const p of players) {
    if (p.id === excludeId || !p.alive) continue;
    const scale = p.scale;
    const cx = p.pos.x;
    const cy = p.pos.y + BALANCE.playerHeight * 0.5 * scale;
    const cz = p.pos.z;
    // Cabeça (esfera menor em cima)
    const hx = p.pos.x;
    const hy = p.pos.y + BALANCE.playerHeight * scale - 0.2 * scale;
    const hz = p.pos.z;
    const hd = sphereRay(hx, hy, hz, 0.22 * scale, origin, dir);
    if (hd <= maxT) hits.push({ t: hd, e: p, headshot: true });
    const bd = sphereRay(cx, cy, cz, 0.55 * scale, origin, dir);
    if (bd <= maxT) hits.push({ t: bd, e: p, headshot: false });
  }
  hits.sort((a, b) => a.t - b.t);
  const first = hits[0];
  if (first) {
    return {
      hit: true,
      targetId: first.e.id,
      headshot: first.headshot,
      end: {
        x: origin.x + dir.x * first.t,
        y: origin.y + dir.y * first.t,
        z: origin.z + dir.z * first.t,
      },
      dmg: 0,
    };
  }
  if (mapHit) {
    return {
      hit: false,
      targetId: -1,
      headshot: false,
      end: { x: origin.x + dir.x * mapHit.t, y: origin.y + dir.y * mapHit.t, z: origin.z + dir.z * mapHit.t },
      dmg: 0,
    };
  }
  return {
    hit: false,
    targetId: -1,
    headshot: false,
    end: { x: origin.x + dir.x * range, y: origin.y + dir.y * range, z: origin.z + dir.z * range },
    dmg: 0,
  };
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

// ===== Linha de visão entre dois pontos (usada por habilidades) =====

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
