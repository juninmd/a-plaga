import { describe, expect, it } from "vitest";
import { shuffle } from "../src/server/shuffle";

describe("shuffle", () => {
  it("keeps the same items and does not touch the input", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input);
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it("gives every player the same chance to be picked first (first zombie, nemesis)", () => {
    const runs = 60_000;
    const first = new Map<number, number>();
    for (let i = 0; i < runs; i++) {
      const [head] = shuffle([1, 2, 3]);
      first.set(head as number, (first.get(head as number) ?? 0) + 1);
    }
    for (const n of [1, 2, 3]) expect((first.get(n) ?? 0) / runs).toBeCloseTo(1 / 3, 1);
    // 6 orders must each appear ~1/6 of the time; the sort() trick gave 37.8% for "123".
    const orders = new Map<string, number>();
    for (let i = 0; i < runs; i++) {
      const k = shuffle([1, 2, 3]).join("");
      orders.set(k, (orders.get(k) ?? 0) + 1);
    }
    expect(orders.size).toBe(6);
    for (const c of orders.values()) expect(Math.abs(c / runs - 1 / 6)).toBeLessThan(0.02);
  });
});
