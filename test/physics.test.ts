import { describe, expect, it } from "vitest";
import { MAP, raycastMap, resolveCollision } from "../src/shared/map.js";
import { moveEntity, shootRay, setTime, createEntity, lookAtYaw } from "../src/server/physics.js";
import { HUMAN_CLASSES, ZOMBIE_CLASSES, WEAPONS } from "../src/shared/balance.js";

describe("física do mapa", () => {
  it("resolve colisão contra caixa central", () => {
    const pos = { x: 0, y: 0, z: -7 };
    const vel = { x: 0, y: 0, z: -1 };
    const hit = resolveCollision(pos, vel, 0.35, MAP.boxes);
    expect(hit).toBe(true);
    expect(pos.z).toBeGreaterThanOrEqual(-10.35);
  });

  it("raycast acerta parede do perímetro", () => {
    const hit = raycastMap({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, MAP.boxes);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeGreaterThan(0);
  });

  it("mantém jogador dentro dos limites do mapa", () => {
    const pos = { x: 100, y: 0, z: 0 };
    const vel = { x: 50, y: 0, z: 0 };
    resolveCollision(pos, vel, 0.35, MAP.boxes);
    expect(pos.x).toBeLessThanOrEqual(MAP.size.x - 0.35);
  });
});

describe("movimento", () => {
  it("anda em linha reta na direção do yaw", () => {
    setTime(0);
    const e = createEntity(1, "t", HUMAN_CLASSES[0], "human", true);
    e.pos = { x: 0, y: 0, z: 0 };
    e.yaw = 0;
    e.input = { moveX: 0, moveY: 1, jump: false, attack: false, ability: false, yaw: 0, pitch: 0 };
    const before = e.pos.z;
    for (let i = 0; i < 10; i++) {
      moveEntity(e, 1 / 20);
      setTime(i + 0.05);
    }
    expect(e.pos.z).toBeLessThan(before);
    expect(Math.abs(e.pos.x)).toBeLessThan(1);
  });

  it("pula quando no chão", () => {
    const e = createEntity(1, "t", HUMAN_CLASSES[0], "human", true);
    e.pos = { x: 0, y: 0, z: 0 };
    e.input = { moveX: 0, moveY: 0, jump: true, attack: false, ability: false, yaw: 0, pitch: 0 };
    moveEntity(e, 1 / 20);
    expect(e.vel.y).toBeGreaterThan(0);
  });
});

describe("tiro (hitscan)", () => {
  it("acerta cabeça como headshot", () => {
    const shooter = createEntity(1, "s", HUMAN_CLASSES[0], "human", true);
    const target = createEntity(2, "t", ZOMBIE_CLASSES[0], "zombie", true);
    shooter.pos = { x: 0, y: 0, z: 0 };
    target.pos = { x: 0, y: 0, z: -2.8 };
    const res = shootRay(
      { x: shooter.pos.x, y: shooter.pos.y + 1.6, z: shooter.pos.z },
      { x: 0, y: 0, z: -1 },
      [shooter, target],
      shooter.id,
      100,
    );
    expect(res.hit).toBe(true);
    expect(res.targetId).toBe(2);
    expect(res.headshot).toBe(true);
  });

  it("não acerta através de parede", () => {
    const shooter = createEntity(1, "s", HUMAN_CLASSES[0], "human", true);
    const target = createEntity(2, "t", ZOMBIE_CLASSES[0], "zombie", true);
    // Parede entre eles: perímetro em z=-48
    shooter.pos = { x: 0, y: 0, z: -40 };
    target.pos = { x: 0, y: 0, z: -60 };
    const res = shootRay(
      { x: 0, y: 1.6, z: -40 },
      { x: 0, y: 0, z: -1 },
      [shooter, target],
      shooter.id,
      100,
    );
    expect(res.hit).toBe(false);
  });
});

describe("balanceamento", () => {
  it("classe padrão humana existe", () => {
    expect(HUMAN_CLASSES[0].id).toBe("assault");
    expect(HUMAN_CLASSES[0].hp).toBe(100);
  });

  it("armas têm munição", () => {
    expect(WEAPONS.rifle.magazine).toBe(30);
    expect(WEAPONS.rifle.dmg).toBeGreaterThan(0);
  });

  it("lookAtYaw aponta para o alvo", () => {
    const yaw = lookAtYaw({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 });
    expect(Math.abs(yaw)).toBeLessThan(0.01);
  });
});
