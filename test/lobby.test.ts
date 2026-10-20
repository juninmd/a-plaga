import { describe, expect, it } from "vitest";
import { Lobby, MAIN_ROOM, MAX_HUMANS } from "../src/server/lobby.js";

const brain = { think: () => {} };
const sink = { send: () => {} };

describe("lobby de salas", () => {
  it("nasce com a sala principal pública", () => {
    const l = new Lobby(brain);
    expect(l.list().map((r) => r.code)).toEqual([MAIN_ROOM]);
  });

  it("sala privada tem código, não aparece na lista e é achada pelo código", () => {
    const l = new Lobby(brain);
    const r = l.createRoom("Os brabos", false)!;
    expect(r.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(l.list().some((x) => x.code === r.code)).toBe(false);
    expect(l.get(r.code.toLowerCase())).toBe(r);
  });

  it("jogar agora enche a sala mais cheia e abre outra quando lota", () => {
    const l = new Lobby(brain);
    const main = l.get(MAIN_ROOM)!;
    for (let i = 0; i < MAX_HUMANS; i++) main.exec((g) => g.addPlayer(`p${i}`, sink));
    expect(main.full).toBe(true);
    const next = l.quickPlay()!;
    expect(next.code).not.toBe(MAIN_ROOM);
    expect(next.isPublic).toBe(true);
  });

  it("humano entrando tira um bot (a sala não passa do alvo)", () => {
    const l = new Lobby(brain);
    const room = l.get(MAIN_ROOM)!;
    room.exec((g) => g.ensureBots());
    const before = room.game.players.length;
    room.exec((g) => {
      room.makeRoomForHuman();
      g.addPlayer("humano", sink);
    });
    expect(room.game.players.length).toBe(before);
    expect(room.humans).toBe(1);
  });

  it("salas têm estado isolado", () => {
    const l = new Lobby(brain);
    const a = l.get(MAIN_ROOM)!;
    const b = l.createRoom("b", false)!;
    a.exec((g) => g.addPlayer("só na A", sink));
    expect(a.humans).toBe(1);
    expect(b.humans).toBe(0);
    for (let i = 0; i < 40; i++) l.tick(0.05);
    expect(a.game.serverTime).toBeGreaterThan(1);
    expect(b.game.serverTime).toBe(0); // sala vazia não consome CPU
  });
});
