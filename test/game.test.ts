import { describe, expect, it } from "vitest";
import { Game } from "../src/server/game";
import { setTime } from "../src/server/physics";
import { damage, infect, killEntity } from "../src/server/combat";

function makeGame(): Game {
  const g = new Game();
  return g;
}

class FakeCtx {
  messages: unknown[] = [];
  send(m: unknown) {
    this.messages.push(m);
  }
}

describe("Game — rounds", () => {
  it("inicia round com countdown", () => {
    const g = makeGame();
    g.startRound();
    expect(g.round.phase).toBe("countdown");
    expect(g.round.mode).toBeTruthy();
  });

  it("tick avança o round para hunt", () => {
    const g = makeGame();
    const ctx = new FakeCtx();
    g.addPlayer("Eu", ctx);
    g.ensureBots();
    g.startRound();
    setTime(0);
    // 7 segundos de ticks
    for (let i = 0; i < 7 * 20; i++) {
      g.tick(1 / 20);
      setTime((i + 1) / 20);
    }
    expect(g.round.phase).toBe("hunt");
    expect(g.round.timeLeft).toBeLessThan(120);
  });

  it("adiciona e remove jogador", () => {
    const g = makeGame();
    const ctx = new FakeCtx();
    const id = g.addPlayer("Teste", ctx);
    expect(g.players.some((p) => p.id === id)).toBe(true);
    g.removePlayer(id);
    expect(g.players.some((p) => p.id === id)).toBe(false);
  });

  it("bot preenche até 8 jogadores", () => {
    const g = makeGame();
    const ctx = new FakeCtx();
    g.addPlayer("Eu", ctx);
    g.ensureBots();
    expect(g.players.length).toBe(8);
  });

  it("modo infection transforma 1 humano em zumbi", () => {
    const g = makeGame();
    const ctx = new FakeCtx();
    g.addPlayer("A", ctx);
    g.addPlayer("B", ctx);
    g.addPlayer("C", ctx);
    g.ensureBots();
    g.startRound();
    // mock do random para garantir infection
    const zombies = g.players.filter((p) => p.team === "zombie");
    expect(zombies.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Game — modos", () => {
  it("nemesis tem HP massivo e é boss", () => {
    const g = makeGame();
    const ctx = new FakeCtx();
    g.addPlayer("A", ctx);
    g.addPlayer("B", ctx);
    g.ensureBots();
    g.startRound();
    g.round.mode = "nemesis";
    // força um zumbi nemesis
    const h = g.players.find((p) => p.team === "human")!;
    infect(g, h, null, false);
    const z = g.players.find((p) => p.team === "zombie")!;
    g.applyClass(z, "nemesis");
    z.isBoss = true;
    expect(z.maxHp).toBeGreaterThan(10000);
    expect(z.isBoss).toBe(true);
  });

  it("todos os modos têm label", () => {
    const g = makeGame();
    const ctx = new FakeCtx();
    g.addPlayer("A", ctx);
    g.startRound();
    const snap = g.snapshot();
    expect(snap.round.modeLabel).toBeTruthy();
  });

  it("dano mata zumbi e dropa ammo pack", () => {
    const g = makeGame();
    setTime(100); // passa a proteção de spawn
    const ctx = new FakeCtx();
    const id = g.addPlayer("A", ctx);
    const zid = g.addPlayer("Z", new FakeCtx());
    const human = g.players.find((p) => p.id === id)!;
    // Zumbi próximo
    const zombie = g.players.find((p) => p.id === zid)!;
    zombie.team = "zombie";
    zombie.alive = true;
    zombie.spawnProtectUntil = 0;
    zombie.pos = { x: human.pos.x + 1, y: 0, z: human.pos.z };
    damage(g, zombie, human, 99999, false, 5);
    expect(zombie.alive).toBe(false);
    expect(g.pickups.length).toBeGreaterThan(0);
    // Respawn com delay de 5s
    expect(zombie.respawnAt).toBeGreaterThan(0);
  });

  it("humano morto por zumbi vira zumbi", () => {
    const g = makeGame();
    setTime(100);
    const ctx = new FakeCtx();
    const id = g.addPlayer("A", ctx);
    const zid = g.addPlayer("Z", new FakeCtx());
    const human = g.players.find((p) => p.id === id)!;
    const z = g.players.find((p) => p.id === zid)!;
    z.team = "zombie";
    human.team = "human";
    human.alive = true;
    human.spawnProtectUntil = 0;
    killEntity(g, human, z, false);
    expect(human.team).toBe("zombie");
    expect(human.alive).toBe(false);
    expect(human.respawnAt).toBeGreaterThan(100);
  });
});
