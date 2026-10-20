import { describe, expect, it } from "vitest";
import { Game } from "../src/server/game.js";
import { botBrain } from "../src/server/bots.js";

describe("bots com o novo movimento", () => {
  it("andam pelo mapa e não ficam presos no spawn", () => {
    const g = new Game(botBrain);
    g.startRound();
    g.ensureBots();
    const start = new Map(g.players.map((p) => [p.id, { x: p.pos.x, z: p.pos.z }]));
    let moved = 0;
    const travelled = new Map<number, number>();
    for (let i = 0; i < 20 * 40; i++) {
      g.tick(0.05);
      g.ensureBots();
      for (const p of g.players) {
        const s = start.get(p.id);
        if (!s) continue;
        travelled.set(p.id, Math.max(travelled.get(p.id) ?? 0, Math.hypot(p.pos.x - s.x, p.pos.z - s.z)));
      }
    }
    for (const d of travelled.values()) if (d > 6) moved++;
    expect(moved).toBeGreaterThanOrEqual(Math.floor(travelled.size / 2));
  });
});
