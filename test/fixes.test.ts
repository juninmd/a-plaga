import { describe, expect, it } from "vitest";
import { Game } from "../src/server/game";
import { setTime } from "../src/server/physics";
import { WEAPONS } from "../src/shared/balance";
import { worldX, worldZ } from "../src/shared/map";
import { checkRoundEnd } from "../src/server/rounds";
import { handleAttack, handleMelee } from "../src/server/combat";
import { dropAmmoPack, explodeProjectile, updatePickups } from "../src/server/abilities";
import { equipSlot } from "../src/server/physics";

class FakeCtx {
  messages: unknown[] = [];
  send(m: unknown) {
    this.messages.push(m);
  }
}

function gameWithPlayers(n: number): Game {
  const g = new Game();
  for (let i = 0; i < n; i++) g.addPlayer(`P${i}`, new FakeCtx());
  return g;
}

describe("regressões de round", () => {
  it("todo modo abre o round com os dois times povoados", () => {
    const g = gameWithPlayers(8);
    setTime(0);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      g.startRound();
      seen.add(g.round.mode);
      const humans = g.players.filter((p) => p.alive && p.team === "human").length;
      const zombies = g.players.filter((p) => p.alive && p.team === "zombie").length;
      expect(`${g.round.mode}:h${humans}`).toBe(`${g.round.mode}:h${humans}`);
      expect(humans, `modo ${g.round.mode} sem humanos`).toBeGreaterThan(0);
      expect(zombies, `modo ${g.round.mode} sem zumbis`).toBeGreaterThan(0);
    }
    // Cobertura: em 60 rounds os modos raros também aparecem
    expect(seen.size).toBeGreaterThan(1);
  });

  it("round novo não herda o time do round anterior", () => {
    const g = gameWithPlayers(6);
    setTime(0);
    for (const p of g.players) p.team = "zombie";
    g.startRound();
    expect(g.players.filter((p) => p.team === "human").length).toBeGreaterThan(0);
  });
});

describe("regressões de chat", () => {
  it("aviso de último zumbi sai uma vez só", () => {
    const g = gameWithPlayers(4);
    setTime(0);
    g.startRound();
    g.round.phase = "hunt";
    for (const p of g.players) {
      p.team = "human";
      p.alive = true;
    }
    g.players[0].team = "zombie";
    g.announcedLastZombie = false;
    g.chats = [];
    for (let i = 0; i < 20; i++) checkRoundEnd(g);
    const avisos = g.chats.filter((c) => c.text.includes("☠️")).length;
    expect(avisos).toBe(1);
  });
});

describe("regressões de combate", () => {
  it("buff de dano expira", () => {
    const g = gameWithPlayers(1);
    setTime(0);
    const e = g.players[0];
    g.applyClass(e, "doomslayer");
    g.useAbility(e);
    expect(e.damageMult).toBe(2);
    g.serverTime = 10; // tick reprograma o relógio a partir do serverTime
    g.round.phase = "hunt";
    g.tick(1 / 20);
    expect(e.damageMult).toBe(1);
  });

  it("arma semi-automática não dispara segurando o botão", () => {
    const g = gameWithPlayers(1);
    setTime(100);
    g.round.phase = "hunt";
    const e = g.players[0];
    e.loadout[2] = { id: "deagle", ammo: 7, reserve: 35 };
    equipSlot(e, 2, true);
    e.input.attack = true;
    handleAttack(g, e);
    expect(e.ammo).toBe(6);
    e.attackHeld = true;
    e.fireCooldown = 0;
    handleAttack(g, e);
    expect(e.ammo).toBe(6); // segurando: nada
    e.attackHeld = false;
    handleAttack(g, e);
    expect(e.ammo).toBe(5); // novo clique: dispara
  });

  it("garra do zumbi não atravessa parede", () => {
    const g = gameWithPlayers(2);
    setTime(100);
    const z = g.players[0];
    const h = g.players[1];
    z.team = "zombie";
    z.weapon = "claws";
    z.isBot = true;
    h.team = "human";
    h.spawnProtectUntil = 0;
    z.pos = { x: worldX(15), y: 0, z: worldZ(15) };
    h.pos = { x: worldX(15) + 1.2, y: 0, z: worldZ(15) };
    z.yaw = -Math.PI / 2; // olhando para +x
    const hpAntes = h.hp;
    handleMelee(g, z);
    expect(h.hp).toBeLessThan(hpAntes); // de frente e sem obstáculo: acerta

    // De costas para o alvo: não acerta
    z.fireCooldown = 0;
    h.hp = hpAntes;
    z.yaw = Math.PI / 2;
    handleMelee(g, z);
    expect(h.hp).toBe(hpAntes);
  });

  it("granada de gelo trava o movimento do alvo", () => {
    const g = gameWithPlayers(2);
    setTime(100);
    const h = g.players[0];
    const z = g.players[1];
    z.team = "zombie";
    z.pos = { x: h.pos.x + 1, y: 0, z: h.pos.z };
    g.projectiles.push({ id: 1, kind: "frost_grenade", pos: { ...z.pos }, vel: { x: 0, y: 0, z: 0 }, owner: h.id, ttl: 0 });
    explodeProjectile(g, g.projectiles[0]);
    expect(z.frozenUntil).toBeGreaterThan(100);
  });

  it("ammo pack repõe reserva do humano", () => {
    const g = gameWithPlayers(1);
    setTime(100);
    const h = g.players[0];
    h.reserve = 0;
    dropAmmoPack(g, { x: h.pos.x, y: 0, z: h.pos.z });
    updatePickups(g);
    expect(h.reserve).toBeGreaterThan(0);
    expect(h.reserve).toBeLessThanOrEqual(WEAPONS[h.weapon].reserve);
  });
});

describe("regressões de classe", () => {
  it("trocar de classe no meio do round não cura", () => {
    const g = gameWithPlayers(1);
    setTime(100);
    g.round.phase = "hunt";
    const e = g.players[0];
    e.spawnProtectUntil = 0;
    e.hp = 20;
    g.handleSelectClass(e.id, "heavy");
    expect(e.hp).toBe(20);
    expect(e.preferredClass).toBe("heavy");
    // Só vale no respawn
    g.spawnAtRandom(e);
    expect(e.classId).toBe("heavy");
    expect(e.hp).toBe(e.maxHp);
  });

  it("cliente não consegue virar boss pela loja", () => {
    const g = gameWithPlayers(1);
    const e = g.players[0];
    g.handleSelectClass(e.id, "survivor");
    expect(e.classId).not.toBe("survivor");
  });

  it("snapshot expõe invisibilidade e recarga", () => {
    const g = gameWithPlayers(1);
    setTime(100);
    const e = g.players[0];
    g.applyClass(e, "ghost");
    g.useAbility(e);
    const snap = g.snapshot();
    expect(snap.players[0].invisible).toBe(true);
    expect(snap.players[0].reloading).toBe(false);
  });
});
