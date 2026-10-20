import { randomInt } from "node:crypto";
import { Game, type BotBrain } from "./game.js";
import { setTime } from "./physics.js";
import type { RoomInfo } from "../shared/protocol.js";

// ===== Salas: cada sala é uma partida independente (rounds, bots, física próprios) =====

export const MAX_HUMANS = 10;
export const MAX_ROOMS = 24;
/** Sala vazia some depois disso (a sala-mãe "ARENA" nunca some). */
const EMPTY_TTL_MS = 60_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
const BOT_TARGET = 8;

export const MAIN_ROOM = "ARENA";

export class Room {
  readonly game: Game;
  emptySince = Date.now();
  started = false;

  constructor(
    readonly code: string,
    readonly name: string,
    readonly isPublic: boolean,
    brain: BotBrain,
  ) {
    this.game = new Game(brain);
  }

  get humans(): number {
    let n = 0;
    for (const p of this.game.players) if (!p.isBot) n++;
    return n;
  }

  get full(): boolean {
    return this.humans >= MAX_HUMANS;
  }

  info(): RoomInfo {
    return {
      code: this.code,
      name: this.name,
      players: this.humans,
      max: MAX_HUMANS,
      mode: this.game.round.modeLabel || "—",
      phase: this.game.round.phase,
      isPublic: this.isPublic,
    };
  }

  /** O relógio do jogo é global (physics.now); cada chamada externa precisa fixar o da sala. */
  exec<T>(fn: (g: Game) => T): T {
    setTime(this.game.serverTime);
    return fn(this.game);
  }

  /** Humano entrando "tira" um bot para a sala não passar do alvo e o humano valer na contagem. */
  makeRoomForHuman() {
    const g = this.game;
    if (g.players.length < BOT_TARGET) return;
    const bots = g.players.filter((p) => p.isBot);
    const victim = bots.find((b) => !b.alive) ?? bots[bots.length - 1];
    if (victim) g.removePlayer(victim.id);
  }
}

export class Lobby {
  private rooms = new Map<string, Room>();

  constructor(private readonly brain: BotBrain) {
    this.create(MAIN_ROOM, "Arena Principal", true);
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  list(): RoomInfo[] {
    return this.all()
      .filter((r) => r.isPublic)
      .map((r) => r.info())
      .sort((a, b) => b.players - a.players);
  }

  private newCode(): string {
    for (let tries = 0; tries < 50; tries++) {
      let c = "";
      for (let i = 0; i < 5; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    return `R${Date.now().toString(36).toUpperCase()}`;
  }

  create(code: string, name: string, isPublic: boolean): Room {
    const room = new Room(code, name, isPublic, this.brain);
    this.rooms.set(code, room);
    room.exec((g) => g.startRound());
    room.started = true;
    return room;
  }

  /** Sala privada (código compartilhável) ou pública extra. null = limite de salas atingido. */
  createRoom(name: string, isPublic: boolean): Room | null {
    if (this.rooms.size >= MAX_ROOMS) return null;
    const clean = name.trim().slice(0, 24).replace(/[<>]/g, "");
    const code = this.newCode();
    return this.create(code, clean || (isPublic ? `Sala ${code}` : `Sala privada ${code}`), isPublic);
  }

  /** "Jogar agora": sala pública com vaga e mais gente; se todas estão cheias, abre outra. */
  quickPlay(): Room | null {
    const open = this.all()
      .filter((r) => r.isPublic && !r.full)
      .sort((a, b) => b.humans - a.humans);
    return open[0] ?? this.createRoom("Arena", true);
  }

  tick(dt: number) {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (room.humans > 0) room.emptySince = now;
      // Sala sem humanos fica só rodando bots por pouco tempo; a principal sempre roda
      else if (room.code !== MAIN_ROOM && now - room.emptySince > EMPTY_TTL_MS) {
        room.game.dispose();
        this.rooms.delete(room.code);
        continue;
      }
      if (room.humans === 0 && room.code !== MAIN_ROOM) continue; // não gasta CPU com sala vazia
      room.exec((g) => {
        g.tick(dt);
        g.ensureBots();
        const snap = g.snapshot();
        for (const ctx of g.clients.values()) ctx.send({ t: "snapshot", d: snap });
        const { fx, kills } = g.drainEvents();
        for (const k of kills) for (const ctx of g.clients.values()) ctx.send({ t: "kill", d: k });
        for (const f of fx) for (const ctx of g.clients.values()) ctx.send({ t: "event", d: f });
      });
    }
  }
}
