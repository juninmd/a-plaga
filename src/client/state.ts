import type { PlayerState, RoundInfo, ServerSnapshot, Team } from "../shared/protocol";
import { RECOIL_ACCUM_PER_SHOT, RECOIL_DECAY_PER_SEC, WEAPONS, effectiveSpread } from "../shared/weapons";

// ===== Estado local do cliente =====

export interface LocalState {
  id: number;
  me: PlayerState | null;
  hp: number;
  armor: number;
  ap: number;
  owned: Set<string>;
  ammo: number;
  reserve: number;
  weapon: string;
  slots: (string | null)[];
  abilityReady: boolean;
  team: Team;
  snapshot: ServerSnapshot | null;
  roundInfo: RoundInfo | null;
  /** Recuo acumulado estimado localmente — abre a mira igual ao servidor. */
  recoilAccum: number;
  /** Instante (ms) da morte local, para o contador de respawn. */
  diedAt: number;
  /** Última morte: quem matou e com quê. */
  deathInfo: { killer: string; weapon: string; headshot: boolean } | null;
  /** Instante (ms) do último tiro previsto no clique — o tracer do servidor logo depois não repete o feedback. */
  predictedShotAt: number;
  ui: {
    chatOpen: boolean;
    shopOpen: boolean;
    scoreOpen: boolean;
    pointerLocked: boolean;
    zooming: boolean;
    connected: boolean;
  };
}

export const state: LocalState = {
  id: -1,
  me: null,
  hp: 100,
  armor: 0,
  ap: 0,
  owned: new Set(),
  ammo: 0,
  reserve: 0,
  weapon: "m4a1",
  slots: [null, null, null],
  abilityReady: true,
  team: "human",
  snapshot: null,
  roundInfo: null,
  recoilAccum: 0,
  diedAt: 0,
  deathInfo: null,
  predictedShotAt: -1e9,
  ui: {
    chatOpen: false,
    shopOpen: false,
    scoreOpen: false,
    pointerLocked: false,
    zooming: false,
    connected: false,
  },
};

/** Registra um tiro próprio: a mira abre e o punch cresce. */
export function registerShot() {
  state.recoilAccum = Math.min(4, state.recoilAccum + RECOIL_ACCUM_PER_SHOT);
}

export function decayRecoil(dt: number) {
  state.recoilAccum = Math.max(0, state.recoilAccum - RECOIL_DECAY_PER_SEC * dt);
}

/** Espalhamento estimado (rad) para desenhar a mira. */
export function estimatedSpread(moving: boolean, airborne: boolean, crouching: boolean): number {
  const w = WEAPONS[state.weapon];
  if (!w || w.slot === 3) return 0;
  return effectiveSpread(w, {
    moving,
    airborne,
    crouching,
    zoomed: state.ui.zooming,
    recoilAccum: state.recoilAccum,
  });
}

/** Qualquer menu aberto: o teclado não vai para o jogo. */
export function menuOpen(): boolean {
  return state.ui.chatOpen || state.ui.shopOpen;
}

export function findPlayer(id: number | undefined): PlayerState | undefined {
  if (id == null || !state.snapshot) return undefined;
  return state.snapshot.players.find((p) => p.id === id);
}

export function weaponName(w: string): string {
  return WEAPONS[w]?.name ?? w;
}
