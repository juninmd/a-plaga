import type { WeaponSlot } from "./protocol.js";

export type WeaponSound = "rifle" | "pistol" | "shotgun" | "sniper" | "smg" | "lmg" | "knife";

export interface WeaponDef {
  id: string;
  name: string;
  slot: WeaponSlot;
  sound: WeaponSound;
  dmg: number;
  headshotMult: number;
  fireRate: number; // tiros por segundo
  magazine: number;
  reserve: number;
  reloadTime: number;
  pellets: number; // escopeta
  spread: number; // rad, parado e sem recuo acumulado
  recoil: number; // coice por tiro (view punch + inacurácia acumulada)
  knockback: number;
  range: number;
  auto: boolean;
  zoom?: number; // FOV quando mira com o botão direito (AWP)
  color: number;
  desc: string;
}

// ===== Arsenal inspirado no CS 1.6, em unidades métricas =====
// Munição/cadência batem com o GoldSrc; dano é maior porque o zumbi tem milhares de HP.

const def = (w: Omit<WeaponDef, "headshotMult" | "pellets"> & { headshotMult?: number; pellets?: number }): WeaponDef => ({
  headshotMult: 4,
  pellets: 1,
  ...w,
});

export const WEAPONS: Record<string, WeaponDef> = {
  // ----- Primárias -----
  ak47: def({ id: "ak47", name: "AK-47", slot: 1, sound: "rifle", dmg: 36, fireRate: 10, magazine: 30, reserve: 90, reloadTime: 2.5, spread: 0.010, recoil: 1.0, knockback: 2.6, range: 140, auto: true, color: 0xc9a04a, desc: "Dano alto, recuo forte." }),
  m4a1: def({ id: "m4a1", name: "M4A1", slot: 1, sound: "rifle", dmg: 33, fireRate: 10.9, magazine: 30, reserve: 90, reloadTime: 3.1, spread: 0.008, recoil: 0.7, knockback: 2.2, range: 140, auto: true, color: 0x8a8f98, desc: "Precisa e estável." }),
  awp: def({ id: "awp", name: "AWP", slot: 1, sound: "sniper", dmg: 115, fireRate: 0.7, magazine: 10, reserve: 30, reloadTime: 3.6, spread: 0.0015, recoil: 2.6, knockback: 12, range: 260, auto: false, zoom: 22, color: 0x4b5e3a, desc: "Um tiro, um zumbi no chão." }),
  mp5: def({ id: "mp5", name: "MP5 Navy", slot: 1, sound: "smg", dmg: 26, fireRate: 13.3, magazine: 30, reserve: 120, reloadTime: 2.6, spread: 0.013, recoil: 0.5, knockback: 1.6, range: 90, auto: true, color: 0x2f3236, desc: "Leve e rápida." }),
  xm1014: def({ id: "xm1014", name: "XM1014", slot: 1, sound: "shotgun", dmg: 20, pellets: 6, fireRate: 4, magazine: 7, reserve: 32, reloadTime: 2.9, spread: 0.06, recoil: 1.2, knockback: 6, range: 32, auto: true, color: 0x3a3a3a, desc: "Escopeta automática." }),
  m3: def({ id: "m3", name: "M3 Super 90", slot: 1, sound: "shotgun", dmg: 26, pellets: 8, fireRate: 1.5, magazine: 8, reserve: 32, reloadTime: 3.0, spread: 0.055, recoil: 1.8, knockback: 9, range: 30, auto: false, color: 0x5c4632, desc: "Empurrão de perto." }),
  m249: def({ id: "m249", name: "M249", slot: 1, sound: "lmg", dmg: 32, fireRate: 12.5, magazine: 100, reserve: 200, reloadTime: 4.7, spread: 0.02, recoil: 0.8, knockback: 3, range: 150, auto: true, color: 0x3a4a2a, desc: "Chuva de chumbo." }),
  // ----- Secundárias -----
  deagle: def({ id: "deagle", name: "Desert Eagle", slot: 2, sound: "pistol", dmg: 54, fireRate: 4, magazine: 7, reserve: 35, reloadTime: 2.2, spread: 0.012, recoil: 1.6, knockback: 5.3, range: 100, auto: false, color: 0x33363c, desc: "Canhão de mão." }),
  usp: def({ id: "usp", name: "USP", slot: 2, sound: "pistol", dmg: 34, fireRate: 7, magazine: 12, reserve: 100, reloadTime: 2.7, spread: 0.009, recoil: 0.7, knockback: 2.5, range: 90, auto: false, color: 0x2b2d31, desc: "Pistola de precisão." }),
  glock: def({ id: "glock", name: "Glock-18", slot: 2, sound: "pistol", dmg: 25, fireRate: 8, magazine: 20, reserve: 120, reloadTime: 2.2, spread: 0.011, recoil: 0.6, knockback: 2, range: 80, auto: false, color: 0x1e1f22, desc: "Pente grande." }),
  // ----- Corpo a corpo -----
  knife: def({ id: "knife", name: "Faca", slot: 3, sound: "knife", dmg: 55, headshotMult: 1.5, fireRate: 2.2, magazine: 1, reserve: 0, reloadTime: 0, spread: 0, recoil: 0, knockback: 2, range: 2.0, auto: true, color: 0xbbbbbb, desc: "Silenciosa." }),
  claws: def({ id: "claws", name: "Garra", slot: 3, sound: "knife", dmg: 40, headshotMult: 1.2, fireRate: 1.7, magazine: 1, reserve: 0, reloadTime: 0, spread: 0, recoil: 0, knockback: 1, range: 2.2, auto: true, color: 0x555555, desc: "A infecção em forma de unha." }),
};

export type WeaponId = keyof typeof WEAPONS;

export const PRIMARY_WEAPONS = Object.values(WEAPONS).filter((w) => w.slot === 1);
export const SECONDARY_WEAPONS = Object.values(WEAPONS).filter((w) => w.slot === 2);

export function isMelee(id: string): boolean {
  return WEAPONS[id]?.slot === 3;
}

// ===== Modelo de inacurácia (CS 1.6): parado/agachado é preciso, andando/pulando espalha =====

export interface AccuracyContext {
  moving: boolean;
  airborne: boolean;
  crouching: boolean;
  zoomed: boolean;
  /** Recuo acumulado (0..n), cresce a cada tiro e decai com o tempo. */
  recoilAccum: number;
}

export function effectiveSpread(w: WeaponDef, ctx: AccuracyContext): number {
  let s = w.spread;
  if (w.zoom && !ctx.zoomed) s *= 40; // AWP de "quadril" não acerta nada
  if (ctx.airborne) s *= 4;
  else if (ctx.moving) s *= 2.5;
  if (ctx.crouching) s *= 0.65;
  s *= 1 + ctx.recoilAccum * 0.9;
  return s;
}

export const RECOIL_DECAY_PER_SEC = 3;
export const RECOIL_ACCUM_PER_SHOT = 0.35;
