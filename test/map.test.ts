import { describe, expect, it } from "vitest";
import { COLS, GRID, MAP, ROWS, isWalkable, cellCol, cellRow, resolveCollision } from "../src/shared/map.js";

describe("mapa de_plague2", () => {
  it("grid é retangular e fechado por paredes", () => {
    for (const row of GRID) expect(row.length).toBe(COLS);
    expect(GRID[0]).toBe("#".repeat(COLS));
    expect(GRID[ROWS - 1]).toBe("#".repeat(COLS));
    for (const row of GRID) {
      expect(row[0]).toBe("#");
      expect(row[COLS - 1]).toBe("#");
    }
  });

  it("todo chão é alcançável a pé a partir do spawn humano", () => {
    const start = MAP.spawns[0].pos;
    const seen = new Set<string>();
    const q: [number, number][] = [[cellCol(start.x), cellRow(start.z)]];
    while (q.length) {
      const [c, r] = q.pop()!;
      const k = `${c},${r}`;
      if (seen.has(k) || !isWalkable(c, r)) continue;
      seen.add(k);
      q.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
    const unreachable: string[] = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) if (isWalkable(c, r) && !seen.has(`${c},${r}`)) unreachable.push(`${c},${r}`);
    expect(unreachable).toEqual([]);
    for (const s of [...MAP.spawns, ...MAP.zombieSpawns]) {
      expect(isWalkable(cellCol(s.pos.x), cellRow(s.pos.z)), `spawn em ${s.pos.x},${s.pos.z}`).toBe(true);
    }
  });

  it("arco deixa passar por baixo e bloqueia a cabeça ao pular", () => {
    const arch = MAP.boxes.find((b) => b.kind === "arch")!;
    const x = (arch.min.x + arch.max.x) / 2;
    const z = (arch.min.z + arch.max.z) / 2;
    const pos = { x, y: 0, z };
    const vel = { x: 0, y: 0, z: 1 };
    resolveCollision(pos, vel, 0.35, MAP.boxes);
    expect(pos.x).toBe(x);
    expect(pos.z).toBe(z);
    // Pulando alto demais: bate a cabeça e para de subir
    const up = { x, y: arch.min.y - 1.0, z };
    const upVel = { x: 0, y: 5, z: 0 };
    resolveCollision(up, upVel, 0.35, MAP.boxes);
    expect(up.y).toBeLessThanOrEqual(arch.min.y - 1.8 + 1e-6);
    expect(upVel.y).toBe(0);
  });
});
