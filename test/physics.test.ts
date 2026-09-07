import { describe, expect, it } from "vitest";
import { MAP, MAP_SIZE, raycastMap, resolveCollision, worldX, worldZ } from "../src/shared/map.js";
import { moveEntity, shootRay, setTime, createEntity, lookAtYaw, emptyInput, bodyHeight } from "../src/server/physics.js";
import { BALANCE, HUMAN_CLASSES, ZOMBIE_CLASSES, WEAPONS } from "../src/shared/balance.js";
import { effectiveSpread } from "../src/shared/weapons.js";

// Meio do mapa (corredor central): coluna 15, linha 19 — chão aberto
const MID = { x: worldX(15), z: worldZ(19) };

describe("física do mapa", () => {
  it("resolve colisão contra parede norte", () => {
    const pos = { x: worldX(14), y: 0, z: -MAP_SIZE.z + 4.2 };
    const vel = { x: 0, y: 0, z: -1 };
    const hit = resolveCollision(pos, vel, 0.35, MAP.boxes);
    expect(hit).toBe(true);
    expect(pos.z).toBeGreaterThanOrEqual(-MAP_SIZE.z + 4);
  });

  it("raycast acerta parede do perímetro", () => {
    const hit = raycastMap({ x: MID.x, y: 1, z: MID.z }, { x: 1, y: 0, z: 0 }, MAP.boxes);
    expect(hit).not.toBeNull();
    expect(hit!.t).toBeGreaterThan(0);
    expect(hit!.normal.x).toBe(-1);
  });

  it("mantém jogador dentro dos limites do mapa", () => {
    const pos = { x: 1000, y: 0, z: 0 };
    const vel = { x: 50, y: 0, z: 0 };
    resolveCollision(pos, vel, 0.35, MAP.boxes);
    expect(pos.x).toBeLessThanOrEqual(MAP.size.x - 0.35);
  });
});

describe("movimento", () => {
  it("anda em linha reta na direção do yaw", () => {
    setTime(0);
    const e = createEntity(1, "t", HUMAN_CLASSES[0], "human", true);
    e.pos = { x: MID.x, y: 0, z: MID.z };
    e.yaw = 0;
    e.input = { ...emptyInput(), moveY: 1 };
    const before = e.pos.z;
    for (let i = 0; i < 10; i++) {
      moveEntity(e, 1 / 20);
      setTime(i + 0.05);
    }
    expect(e.pos.z).toBeLessThan(before);
    expect(Math.abs(e.pos.x - MID.x)).toBeLessThan(1);
  });

  it("pula quando no chão", () => {
    const e = createEntity(1, "t", HUMAN_CLASSES[0], "human", true);
    e.pos = { x: MID.x, y: 0, z: MID.z };
    e.input = { ...emptyInput(), jump: true };
    moveEntity(e, 1 / 20);
    expect(e.vel.y).toBeGreaterThan(0);
  });

  it("agachar reduz velocidade e altura do corpo", () => {
    setTime(0);
    const run = (crouch: boolean) => {
      const e = createEntity(1, "t", HUMAN_CLASSES[0], "human", true);
      e.pos = { x: MID.x, y: 0, z: MID.z };
      e.input = { ...emptyInput(), moveY: 1, crouch };
      for (let i = 0; i < 20; i++) moveEntity(e, 1 / 20);
      return e;
    };
    const up = run(false);
    const down = run(true);
    expect(down.crouching).toBe(true);
    expect(bodyHeight(down)).toBeLessThan(bodyHeight(up));
    expect(Math.hypot(down.vel.x, down.vel.z)).toBeLessThan(Math.hypot(up.vel.x, up.vel.z) * 0.6);
    expect(Math.hypot(down.vel.x, down.vel.z)).toBeCloseTo(BALANCE.baseSpeed * BALANCE.crouchSpeedMult, 1);
  });
});

describe("tiro (hitscan)", () => {
  it("acerta cabeça como headshot", () => {
    const shooter = createEntity(1, "s", HUMAN_CLASSES[0], "human", true);
    const target = createEntity(2, "t", ZOMBIE_CLASSES[0], "zombie", true);
    shooter.pos = { x: MID.x, y: 0, z: MID.z };
    target.pos = { x: MID.x, y: 0, z: MID.z - 2.8 };
    const res = shootRay({ x: MID.x, y: 1.6, z: MID.z }, { x: 0, y: 0, z: -1 }, [shooter, target], shooter.id, 100);
    expect(res.hit).toBe(true);
    expect(res.targetId).toBe(2);
    expect(res.headshot).toBe(true);
  });

  it("alvo agachado tem a cabeça mais baixa", () => {
    const shooter = createEntity(1, "s", HUMAN_CLASSES[0], "human", true);
    const target = createEntity(2, "t", ZOMBIE_CLASSES[0], "zombie", true);
    shooter.pos = { x: MID.x, y: 0, z: MID.z };
    target.pos = { x: MID.x, y: 0, z: MID.z - 2.8 };
    target.crouching = true;
    const res = shootRay({ x: MID.x, y: 1.6, z: MID.z }, { x: 0, y: 0, z: -1 }, [shooter, target], shooter.id, 100);
    expect(res.headshot).toBe(false); // na altura de 1.6 não tem mais cabeça
    const low = shootRay({ x: MID.x, y: BALANCE.crouchHeight - 0.2, z: MID.z }, { x: 0, y: 0, z: -1 }, [shooter, target], shooter.id, 100);
    expect(low.headshot).toBe(true);
  });

  it("não acerta através de parede", () => {
    const shooter = createEntity(1, "s", HUMAN_CLASSES[0], "human", true);
    const target = createEntity(2, "t", ZOMBIE_CLASSES[0], "zombie", true);
    // Parede entre o meio (col 15) e o long A (col 30) na linha 12
    shooter.pos = { x: worldX(15), y: 0, z: worldZ(12) };
    target.pos = { x: worldX(30), y: 0, z: worldZ(12) };
    const res = shootRay({ x: shooter.pos.x, y: 1.6, z: shooter.pos.z }, { x: 1, y: 0, z: 0 }, [shooter, target], shooter.id, 100);
    expect(res.hit).toBe(false);
    expect(res.normal).not.toBeNull();
  });
});

describe("balanceamento", () => {
  it("classe padrão humana existe", () => {
    expect(HUMAN_CLASSES[0].id).toBe("assault");
    expect(HUMAN_CLASSES[0].hp).toBe(100);
  });

  it("armas têm munição", () => {
    expect(WEAPONS.m4a1.magazine).toBe(30);
    expect(WEAPONS.m4a1.dmg).toBeGreaterThan(0);
    expect(WEAPONS.claws.slot).toBe(3);
  });

  it("spread cresce com recuo e cai agachado", () => {
    const w = WEAPONS.ak47;
    const base = { moving: false, airborne: false, crouching: false, zoomed: false, recoilAccum: 0 };
    const still = effectiveSpread(w, base);
    expect(effectiveSpread(w, { ...base, recoilAccum: 2 })).toBeGreaterThan(still);
    expect(effectiveSpread(w, { ...base, crouching: true })).toBeLessThan(still);
    expect(effectiveSpread(w, { ...base, moving: true })).toBeGreaterThan(still);
    expect(effectiveSpread(WEAPONS.awp, base)).toBeGreaterThan(effectiveSpread(WEAPONS.awp, { ...base, zoomed: true }));
  });

  it("lookAtYaw aponta para o alvo", () => {
    const yaw = lookAtYaw({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -10 });
    expect(Math.abs(yaw)).toBeLessThan(0.01);
  });
});
