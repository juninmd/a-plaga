import { describe, expect, it } from "vitest";
import { Game } from "../src/server/game";
import { botBrain } from "../src/server/bots";
import { handleMelee } from "../src/server/combat";
import { findPath } from "../src/server/nav";
import { equipSlot, setTime } from "../src/server/physics";
import { MAP, cellCol, cellRow, isWalkable, worldX, worldZ } from "../src/shared/map";
import { WEAPONS } from "../src/shared/weapons";
import { BALANCE, HUMAN_CLASSES, ZOMBIE_CLASSES } from "../src/shared/balance";

class FakeCtx {
  messages: { t: string; d?: unknown }[] = [];
  send(m: unknown) {
    this.messages.push(m as { t: string; d?: unknown });
  }
}

function gameWithPlayers(n: number): { g: Game; ctxs: FakeCtx[] } {
  const g = new Game(botBrain);
  const ctxs: FakeCtx[] = [];
  for (let i = 0; i < n; i++) {
    const c = new FakeCtx();
    ctxs.push(c);
    g.addPlayer(`P${i}`, c);
  }
  return { g, ctxs };
}

describe("navegação (A*)", () => {
  it("encontra caminho do spawn humano ao spawn zumbi sem cruzar paredes", () => {
    const path = findPath(MAP.spawns[0].pos, MAP.zombieSpawns[0].pos);
    expect(path.length).toBeGreaterThan(10);
    for (const p of path) expect(isWalkable(cellCol(p.x), cellRow(p.z)), `${p.x},${p.z}`).toBe(true);
    // Passos consecutivos são vizinhos (no máximo uma célula na diagonal)
    let prev = MAP.spawns[0].pos;
    for (const p of path) {
      expect(Math.abs(cellCol(p.x) - cellCol(prev.x))).toBeLessThanOrEqual(1);
      expect(Math.abs(cellRow(p.z) - cellRow(prev.z))).toBeLessThanOrEqual(1);
      prev = p;
    }
  });

  it("destino dentro de parede não tem caminho", () => {
    expect(findPath(MAP.spawns[0].pos, { x: worldX(0), y: 0, z: worldZ(0) })).toEqual([]);
  });
});

describe("loadout e compra de armas", () => {
  it("humano nasce com primária, secundária e faca; zumbi só com garra", () => {
    const { g } = gameWithPlayers(2);
    setTime(0);
    const h = g.players[0];
    expect(h.loadout[1]?.id).toBe("m4a1");
    expect(h.loadout[2]?.id).toBe("usp");
    expect(h.loadout[3]?.id).toBe("knife");
    expect(h.weapon).toBe("m4a1");
    const z = g.players[1];
    z.team = "zombie";
    g.applyClass(z, "classic");
    expect(z.weapon).toBe("claws");
    expect(z.loadout[1]).toBeNull();
  });

  it("compra é aceita no spawn e recusada longe dele ou em classe travada", () => {
    const { g, ctxs } = gameWithPlayers(1);
    setTime(100);
    g.round.phase = "hunt";
    const e = g.players[0];
    e.spawnProtectUntil = 0;
    g.handleBuyWeapon(e.id, "ak47");
    expect(e.weapon).toBe("ak47");
    expect(e.ammo).toBe(WEAPONS.ak47.magazine);

    e.pos = { x: worldX(15), y: 0, z: worldZ(20) }; // meio do mapa
    ctxs[0].messages = [];
    g.handleBuyWeapon(e.id, "awp");
    expect(e.weapon).toBe("ak47");
    expect(ctxs[0].messages.some((m) => m.t === "error" && String(m.d).includes("spawn"))).toBe(true);

    g.handleSelectClass(e.id, "heavy");
    g.spawnAtRandom(e);
    expect(e.weapon).toBe("m249");
    g.handleBuyWeapon(e.id, "ak47");
    expect(e.weapon).toBe("m249");
    g.handleBuyWeapon(e.id, "glock");
    expect(e.loadout[2]?.id).toBe("glock");
  });

  it("trocar de slot muda a arma e impõe tempo de saque", () => {
    const { g } = gameWithPlayers(1);
    setTime(100);
    const e = g.players[0];
    g.handleSwitch(e.id, 2);
    expect(e.weapon).toBe("usp");
    expect(e.fireCooldown).toBeGreaterThan(0);
    e.ammo = 3;
    g.handleSwitch(e.id, 3);
    expect(e.weapon).toBe("knife");
    expect(e.loadout[2]?.ammo).toBe(3); // munição do slot fica guardada
    g.handleSwitch(e.id, 1);
    expect(e.weapon).toBe("m4a1");
  });

  it("recarga manual repõe o pente", () => {
    const { g } = gameWithPlayers(1);
    const e = g.players[0];
    e.ammo = 5;
    g.handleReload(e.id);
    expect(e.reloading).toBeGreaterThan(0);
    expect(e.ammo).toBe(WEAPONS.m4a1.magazine);
    expect(e.reserve).toBe(WEAPONS.m4a1.reserve - 25);
  });

  it("faca do humano acerta só de frente", () => {
    const { g } = gameWithPlayers(2);
    setTime(100);
    const h = g.players[0];
    const z = g.players[1];
    z.team = "zombie";
    z.spawnProtectUntil = 0;
    h.pos = { x: worldX(15), y: 0, z: worldZ(19) };
    z.pos = { x: worldX(15), y: 0, z: worldZ(19) - 1.2 };
    equipSlot(h, 3, true);
    h.input.attack = true;
    h.yaw = 0; // olhando para -z
    const before = z.hp;
    handleMelee(g, h);
    expect(z.hp).toBeLessThan(before);
    h.fireCooldown = 0;
    z.hp = before;
    h.yaw = Math.PI;
    handleMelee(g, h);
    expect(z.hp).toBe(before);
  });
});

describe("bots com navegação", () => {
  it("zumbi bot se aproxima do humano atravessando o mapa", () => {
    const { g } = gameWithPlayers(1);
    setTime(0);
    g.startRound();
    g.round.phase = "hunt";
    const h = g.players[0];
    h.team = "human";
    h.alive = true;
    h.pos = { x: worldX(15), y: 0, z: worldZ(14) + 2 }; // meio
    g.ensureBots();
    for (const b of g.players) {
      if (b === h) continue;
      b.team = "zombie";
      g.applyClass(b, "classic");
      b.alive = true;
      b.pos = { x: worldX(15), y: 0, z: worldZ(36) }; // T spawn
    }
    const bot = g.players.find((p) => p.isBot)!;
    const d0 = Math.hypot(bot.pos.x - h.pos.x, bot.pos.z - h.pos.z);
    for (let i = 0; i < 20 * 5; i++) {
      g.serverTime = i / 20;
      g.tick(1 / 20);
      h.hp = h.maxHp;
      h.pos = { x: worldX(15), y: 0, z: worldZ(14) + 2 };
    }
    const d1 = Math.hypot(bot.pos.x - h.pos.x, bot.pos.z - h.pos.z);
    expect(d1).toBeLessThan(d0 - 15);
  });
});

describe("regressão de munição ao trocar loadout", () => {
  it("trocar de classe/comprar não herda a munição da arma anterior", () => {
    const { g } = gameWithPlayers(1);
    setTime(0);
    const e = g.players[0];
    e.ammo = 3;
    e.reserve = 0;
    g.handleSelectClass(e.id, "heavy");
    expect(e.weapon).toBe("m249");
    expect(e.ammo).toBe(WEAPONS.m249.magazine);
    expect(e.reserve).toBe(WEAPONS.m249.reserve);
    e.ammo = 7;
    g.handleBuyWeapon(e.id, "deagle");
    expect(e.loadout[1]?.ammo).toBe(7);
    expect(e.ammo).toBe(WEAPONS.deagle.magazine);
    g.handleBuyWeapon(e.id, "glock");
    expect(e.ammo).toBe(WEAPONS.glock.magazine);
  });
});

describe("entrada não confiável", () => {
  it("input com NaN/Infinity não contamina a posição", () => {
    const g = new Game();
    const id = g.addPlayer("X", { send() {} });
    const e = g.players[0];
    g.round.phase = "hunt";
    g.handleInput(id, { moveX: Number.NaN, moveY: Number.POSITIVE_INFINITY, yaw: Number.NaN, pitch: 9, jump: "sim" as never, crouch: false, attack: false, ability: false, zoom: false });
    for (let i = 0; i < 20; i++) g.tick(1 / 20);
    expect(Number.isFinite(e.pos.x)).toBe(true);
    expect(Number.isFinite(e.pos.z)).toBe(true);
    expect(e.pitch).toBeLessThanOrEqual(1.5);
    expect(e.input.jump).toBe(false);
  });

  it("chat sem texto string é ignorado", () => {
    const g = new Game();
    const id = g.addPlayer("X", { send() {} });
    const before = g.chats.length;
    g.handleChat(id, undefined as never);
    g.handleChat(id, 42 as never);
    expect(g.chats.length).toBe(before);
  });
});

describe("spawn points", () => {
  it("em todo modo, zumbis e humanos nascem longe uns dos outros e sem sobreposição", () => {
    const g = new Game();
    for (let i = 0; i < 8; i++) g.addPlayer(`P${i}`, { send() {} });
    const seen = new Set<string>();
    for (let round = 0; round < 40; round++) {
      g.startRound();
      seen.add(g.round.mode);
      const alive = g.players.filter((p) => p.alive);
      for (const a of alive) {
        for (const b of alive) {
          if (a === b) continue;
          const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
          if (a.team !== b.team) expect(d, `${g.round.mode}: ${a.name}(${a.team}) perto de ${b.name}(${b.team})`).toBeGreaterThanOrEqual(25);
          else expect(d, `${g.round.mode}: ${a.name} em cima de ${b.name}`).toBeGreaterThan(1);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it("zumbi comum é mais lento que o humano padrão", () => {
    const zombie = ZOMBIE_CLASSES.find((c) => c.id === "classic")!;
    const human = HUMAN_CLASSES.find((c) => c.id === "assault")!;
    expect(zombie.speed).toBeLessThan(human.speed);
    expect(zombie.speed * BALANCE.firstZombieFurySpeed).toBeLessThanOrEqual(1.15);
  });
});
