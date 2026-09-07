export type Team = "human" | "zombie";
export type GameMode =
  | "infection"
  | "multi"
  | "swarm"
  | "nemesis"
  | "survivor"
  | "plague"
  | "armageddon";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Slot de arma no estilo CS: 1 primária, 2 secundária, 3 faca/garra. */
export type WeaponSlot = 1 | 2 | 3;

export interface PlayerState {
  id: number;
  name: string;
  team: Team;
  classId: string;
  pos: Vec3;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  speedMult: number;
  scale: number;
  color: number;
  isBoss: boolean;
  weapon: string;
  abilityReady: boolean;
  ammo: number;
  reserve: number;
  kills: number;
  infections: number;
  deaths: number;
  streak: number;
  armor: number;
  invisible: boolean;
  reloading: boolean;
  crouching: boolean;
  /** Velocidade horizontal (m/s) — o cliente usa para passos e animação. */
  speed: number;
  /** Velocidade completa — a predição local reconcilia com ela. */
  vel: Vec3;
  /** Armas nos slots 1/2/3 (só é preenchido para o próprio jogador). */
  slots?: (string | null)[];
}

export interface RoundInfo {
  mode: GameMode;
  phase: "countdown" | "hunt" | "last_human" | "over";
  timeLeft: number;
  zombies: number;
  humans: number;
  firstZombie: string;
  modeLabel: string;
  number: number;
}

export interface PickupState {
  id: number;
  kind: "ammopack" | "weapon";
  pos: Vec3;
  value: number;
}

export interface ProjectileState {
  id: number;
  kind: string;
  pos: Vec3;
  vel: Vec3;
  owner: number;
}

export type FxKind =
  | "tracer"
  | "impact"
  | "blood"
  | "damage"
  | "melee"
  | "explosion"
  | "infect"
  | "heal"
  | "frost"
  | "acid"
  | "speed"
  | "leap"
  | "invisible"
  | "pickup"
  | "tongue"
  | "death";

export interface FxEvent {
  kind: FxKind;
  pos: Vec3;
  color: number;
  value?: number;
  from?: Vec3; // origem (tracers saem da arma de quem atirou, não da câmera local)
  normal?: Vec3; // normal da superfície (impactos de bala)
  src?: number; // id de quem causou
  dst?: number; // id de quem recebeu
  weapon?: string;
}

export interface KillFeedEntry {
  killer: string;
  victim: string;
  weapon: string;
  headshot: boolean;
  streak?: number;
  streakLabel?: string;
}

export interface ChatMessage {
  name: string;
  text: string;
  system?: boolean;
  color?: number;
}

export interface ServerSnapshot {
  t: number;
  players: PlayerState[];
  pickups: PickupState[];
  projectiles: ProjectileState[];
  round: RoundInfo;
  serverTime: number;
}

// ===== Client -> Server =====

export interface InputState {
  moveX: number;
  moveY: number;
  jump: boolean;
  crouch: boolean;
  attack: boolean;
  yaw: number;
  pitch: number;
  ability: boolean;
  zoom: boolean;
}

export interface JoinPayload {
  name: string;
}

export interface BuyPayload {
  itemId: string;
}

export interface SelectClassPayload {
  classId: string;
}

export type ClientMsg =
  | { t: "join"; d: JoinPayload }
  | { t: "input"; d: InputState }
  | { t: "buy"; d: BuyPayload }
  | { t: "buyWeapon"; d: { weaponId: string } }
  | { t: "switch"; d: { slot: WeaponSlot } }
  | { t: "reload" }
  | { t: "selectClass"; d: SelectClassPayload }
  | { t: "chat"; d: { text: string } };

// ===== Server -> Client (events) =====

export type ServerMsg =
  | { t: "welcome"; d: { id: number; snapshot: ServerSnapshot } }
  | { t: "snapshot"; d: ServerSnapshot }
  | { t: "event"; d: FxEvent }
  | { t: "kill"; d: KillFeedEntry }
  | { t: "chat"; d: ChatMessage }
  | { t: "roundStart"; d: RoundInfo }
  | { t: "roundEnd"; d: { winner: Team | "draw"; reason: string } }
  | { t: "self"; d: Partial<PlayerState> }
  | { t: "shop"; d: { ap: number; owned: string[] } }
  | { t: "tick"; d: { hp: number; armor: number; ap: number; ammo: number; reserve: number } }
  | { t: "error"; d: string };

export const PROTOCOL = "a-plaga-v2";
