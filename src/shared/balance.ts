import type { GameMode, Team } from "./protocol.js";

// ===== Balanceamento herdado do BALANCE.md do zplague-addons =====
// Multiplicadores de speed/gravity seguem o padrao ZP50 (1.0 = base 260 u/s).

export const BALANCE = {
  baseSpeed: 260,
  playerRadius: 0.35,
  playerHeight: 1.8,
  eyeHeight: 1.6,
  gravity: 20,
  jumpVel: 8.2,
  knockbackPower: 6,
  knockbackDistance: 600,
  zombieDefenseMult: 0.75,
  apStarting: 1000,
  apKillZombie: 3,
  apKillHuman: 2,
  apInfect: 1,
  apDamageDiv: 500,
  apWinner: 3,
  apLoser: 1,
  roundTime: 120,
  countdownTime: 6,
  spawnProtection: 5,
  firstZombieFurySpeed: 1.3,
  firstZombieFuryDamage: 1.25,
  lastHumanBonusHp: 500,
  tickRate: 20,
} as const;

export interface WeaponDef {
  name: string;
  dmg: number;
  headshotMult: number;
  fireRate: number; // shots per second
  magazine: number;
  reserve: number;
  reloadTime: number;
  pellets: number; // shotgun spread
  spread: number;
  knockback: number;
  range: number;
  auto: boolean;
  color: number;
}

export const WEAPONS: Record<string, WeaponDef> = {
  rifle: {
    name: "Fuzil M4",
    dmg: 26,
    headshotMult: 1.5,
    fireRate: 9,
    magazine: 30,
    reserve: 90,
    reloadTime: 2.2,
    pellets: 1,
    spread: 0.008,
    knockback: 2.2,
    range: 120,
    auto: true,
    color: 0x8a8f98,
  },
  shotgun: {
    name: "Escopeta XM",
    dmg: 12,
    headshotMult: 1.5,
    fireRate: 1.5,
    magazine: 8,
    reserve: 32,
    reloadTime: 2.8,
    pellets: 9,
    spread: 0.055,
    knockback: 8,
    range: 30,
    auto: false,
    color: 0x5c4632,
  },
  deagle: {
    name: "Deagle",
    dmg: 45,
    headshotMult: 1.5,
    fireRate: 3.5,
    magazine: 7,
    reserve: 35,
    reloadTime: 1.8,
    pellets: 1,
    spread: 0.015,
    knockback: 5.3,
    range: 80,
    auto: false,
    color: 0x33363c,
  },
  m249: {
    name: "M249",
    dmg: 30,
    headshotMult: 1.5,
    fireRate: 10,
    magazine: 100,
    reserve: 100000,
    reloadTime: 3.5,
    pellets: 1,
    spread: 0.02,
    knockback: 3,
    range: 140,
    auto: true,
    color: 0x3a4a2a,
  },
  knife: {
    name: "Garra",
    dmg: 40,
    headshotMult: 1.2,
    fireRate: 1.7,
    magazine: 1,
    reserve: 0,
    reloadTime: 0,
    pellets: 1,
    spread: 0,
    knockback: 1,
    range: 2.2,
    auto: false,
    color: 0x555,
  },
} as const;

export type WeaponId = keyof typeof WEAPONS;

// ===== Classes =====

export interface ClassDef {
  id: string;
  name: string;
  side: Team;
  hp: number;
  speed: number;
  gravity: number;
  knockback: number;
  ability: string;
  abilityCooldown: number;
  desc: string;
  color: number;
  scale?: number;
  armor?: number;
  weapon?: WeaponId;
  levelReq?: number;
}

export const ZOMBIE_CLASSES: ClassDef[] = [
  {
    id: "classic",
    name: "Clássico",
    side: "zombie",
    hp: 3000,
    speed: 1.0,
    gravity: 1.0,
    knockback: 1.0,
    ability: "Garra venenosa — dano em área",
    abilityCooldown: 6,
    desc: "Equilibrado. A base da horda.",
    color: 0x4caf50,
  },
  {
    id: "runner",
    name: "Runner",
    side: "zombie",
    hp: 1200,
    speed: 1.2,
    gravity: 0.9,
    knockback: 1.1,
    ability: "Frenesi — +50% velocidade 3s",
    abilityCooldown: 8,
    desc: "Rápido, frágil. Fecha distância.",
    color: 0xffb300,
  },
  {
    id: "tank",
    name: "Tank",
    side: "zombie",
    hp: 4000,
    speed: 0.9,
    gravity: 1.0,
    knockback: 0.5,
    ability: "Salto devastador + onda de choque",
    abilityCooldown: 10,
    desc: "Lento, quase imune a knockback.",
    color: 0x8d6e63,
    scale: 1.3,
  },
  {
    id: "boomer",
    name: "Boomer",
    side: "zombie",
    hp: 1500,
    speed: 0.8,
    gravity: 1.0,
    knockback: 1.5,
    ability: "Bile — explode ao morrer cegando",
    abilityCooldown: 0,
    desc: "Não atire perto dos aliados.",
    color: 0x9ccc65,
  },
  {
    id: "smoker",
    name: "Smoker",
    side: "zombie",
    hp: 2500,
    speed: 0.9,
    gravity: 0.85,
    knockback: 1.2,
    ability: "Língua — puxa o humano mirado",
    abilityCooldown: 14,
    desc: "Separa a defesa pela raiz.",
    color: 0x7cb342,
  },
  {
    id: "spitter",
    name: "Spitter",
    side: "zombie",
    hp: 2000,
    speed: 1.05,
    gravity: 0.9,
    knockback: 1.2,
    ability: "Ácido — cuspe em área 8 dmg/s",
    abilityCooldown: 12,
    desc: "Derruba fortificações com tempo.",
    color: 0x66bb6a,
  },
  {
    id: "witch",
    name: "Witch",
    side: "zombie",
    hp: 3000,
    speed: 1.3,
    gravity: 0.9,
    knockback: 0.7,
    ability: "Garra letal — 200 de dano",
    abilityCooldown: 5,
    desc: "Não faça contato visual.",
    color: 0x81c784,
  },
];

export const HUMAN_CLASSES: ClassDef[] = [
  {
    id: "assault",
    name: "Assault",
    side: "human",
    hp: 100,
    speed: 1.0,
    gravity: 1.0,
    knockback: 1.0,
    ability: "Granada de fogo (E)",
    abilityCooldown: 20,
    desc: "O soldado padrão. Rifle confiável.",
    color: 0x2e7dd1,
    weapon: "rifle",
  },
  {
    id: "medic",
    name: "Médico",
    side: "human",
    hp: 100,
    speed: 1.0,
    gravity: 1.0,
    knockback: 1.0,
    ability: "Cura área — 50 HP aliados",
    abilityCooldown: 15,
    desc: "Mantém a linha de frente viva.",
    color: 0x26a69a,
    weapon: "rifle",
  },
  {
    id: "heavy",
    name: "Heavy",
    side: "human",
    hp: 250,
    speed: 0.85,
    gravity: 1.0,
    knockback: 0.6,
    ability: "Rage — +50% vel 5s",
    abilityCooldown: 30,
    desc: "Tanque humano. M2 lenta mas firme.",
    color: 0xef5350,
    weapon: "m249",
    armor: 100,
    scale: 1.15,
  },
  {
    id: "ghost",
    name: "Fantasma",
    side: "human",
    hp: 100,
    speed: 1.1,
    gravity: 0.9,
    knockback: 1.0,
    ability: "Invisível 5s",
    abilityCooldown: 20,
    desc: "Some dos olhos da horda.",
    color: 0xcfd8dc,
    weapon: "deagle",
  },
  {
    id: "doomslayer",
    name: "Doom Slayer",
    side: "human",
    hp: 120,
    speed: 1.05,
    gravity: 1.0,
    knockback: 1.0,
    ability: "Berserk — +60% vel 4s",
    abilityCooldown: 14,
    desc: "A caçada é a recompensa. Nível 8.",
    color: 0xb71c1c,
    weapon: "shotgun",
    levelReq: 8,
  },
];

export const NEMESIS_CLASS: ClassDef = {
  id: "nemesis",
  name: "NEMESIS",
  side: "zombie",
  hp: 12000,
  speed: 1.05,
  gravity: 0.5,
  knockback: 0.1,
  ability: "Salto longo + impacto",
  abilityCooldown: 4,
  desc: "O predador do round.",
  color: 0xff1744,
  scale: 1.25,
};

export const SURVIVOR_CLASS: ClassDef = {
  id: "survivor",
  name: "SURVIVOR",
  side: "human",
  hp: 2000,
  speed: 0.95,
  gravity: 1.0,
  knockback: 1.0,
  ability: "M249 sem recuo",
  abilityCooldown: 0,
  desc: "O último bastião.",
  color: 0x29b6f6,
  weapon: "m249",
  armor: 200,
  scale: 1.1,
};

export const CLASS_INDEX: Record<string, ClassDef> = Object.fromEntries(
  [...ZOMBIE_CLASSES, ...HUMAN_CLASSES, NEMESIS_CLASS, SURVIVOR_CLASS].map((c) => [c.id, c]),
);

// ===== Modos =====

export interface ModeDef {
  id: GameMode;
  label: string;
  chance: number; // 1-em-X
  desc: string;
}

export const MODES: ModeDef[] = [
  { id: "infection", label: "INFECTION", chance: 1, desc: "1 humano vira o primeiro zumbi" },
  { id: "multi", label: "MULTI", chance: 20, desc: "Vários zumbis iniciais" },
  { id: "swarm", label: "SWARM", chance: 20, desc: "Zumbis vs humanos, sem infecção" },
  { id: "nemesis", label: "NEMESIS", chance: 25, desc: "1 Nemesis contra todos" },
  { id: "survivor", label: "SURVIVOR", chance: 25, desc: "1 Survivor com M249 infinita" },
  { id: "plague", label: "PLAGUE", chance: 28, desc: "Nemesis + Survivor + horda" },
  { id: "armageddon", label: "ARMAGEDDON", chance: 35, desc: "Metade Survivors vs metade Nemesis" },
];

export const MODE_INDEX: Record<GameMode, ModeDef> = Object.fromEntries(MODES.map((m) => [m.id, m])) as never;

// ===== Itens extras (menu B) =====

export interface ItemDef {
  id: string;
  name: string;
  cost: number;
  side: Team | "both";
  desc: string;
}

export const EXTRA_ITEMS: ItemDef[] = [
  { id: "adrenaline", name: "Adrenalina", cost: 15, side: "human", desc: "+40% velocidade por 8s" },
  { id: "medkit", name: "Medkit", cost: 20, side: "human", desc: "Cura 60 HP na hora" },
  { id: "fire_grenade", name: "Granada de Fogo", cost: 25, side: "human", desc: "Dano em área 120" },
  { id: "frost_grenade", name: "Granada de Gelo", cost: 20, side: "human", desc: "Congela zumbis 3s" },
  { id: "pipebomb", name: "Pipe Bomb", cost: 30, side: "human", desc: "Dano massivo 300" },
  { id: "armor", name: "Colete", cost: 25, side: "human", desc: "+100 de armadura" },
  { id: "zombie_speed", name: "Instinto", cost: 20, side: "zombie", desc: "+30% velocidade 10s" },
  { id: "zombie_heal", name: "Regeneração", cost: 25, side: "zombie", desc: "Cura 500 HP" },
  { id: "zombie_rage", name: "Fúria", cost: 30, side: "zombie", desc: "+50% dano 8s" },
  { id: "zombie_dash", name: "Investida", cost: 20, side: "zombie", desc: "Salto longo na mira" },
];

export const ITEM_INDEX: Record<string, ItemDef> = Object.fromEntries(EXTRA_ITEMS.map((i) => [i.id, i]));

// ===== Killstreaks =====

export const STREAKS = [
  { kills: 3, label: "IMPAREÁVEL" },
  { kills: 5, label: "DOMINADOR" },
  { kills: 7, label: "DEUS DO ZP" },
];
