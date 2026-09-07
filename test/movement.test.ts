import { describe, expect, it } from "vitest";
import { stepMovement, type MoverState } from "../src/shared/movement.js";
import { reconcilePosition, SNAP_DISTANCE } from "../src/client/predict.js";
import { lerpAngle } from "../src/client/interp.js";
import { BALANCE } from "../src/shared/balance.js";

function mover(): MoverState {
  return {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    onGround: true,
    crouching: false,
    yaw: 0,
    speedMult: 1,
    buffSpeed: 1,
    gravityMult: 1,
    scale: 1,
  };
}

describe("movimento compartilhado (servidor = cliente)", () => {
  it("é determinístico: mesma entrada, mesma posição", () => {
    const a = mover();
    const b = mover();
    const input = { moveX: 0.3, moveY: 1, jump: false, crouch: false };
    for (let i = 0; i < 60; i++) {
      stepMovement(a, input, 1 / 60);
      stepMovement(b, input, 1 / 60);
    }
    expect(a.pos).toEqual(b.pos);
    expect(a.vel).toEqual(b.vel);
    expect(a.pos.z).toBeLessThan(-3); // andou para frente (yaw 0 olha para -z)
  });

  it("agachado anda mais devagar e pula só em pé", () => {
    const up = mover();
    const down = mover();
    for (let i = 0; i < 40; i++) {
      stepMovement(up, { moveX: 0, moveY: 1, jump: false, crouch: false }, 1 / 20);
      stepMovement(down, { moveX: 0, moveY: 1, jump: true, crouch: true }, 1 / 20);
    }
    expect(Math.abs(down.pos.z)).toBeLessThan(Math.abs(up.pos.z) * (BALANCE.crouchSpeedMult + 0.05));
    expect(down.pos.y).toBe(0);
    expect(down.crouching).toBe(true);
  });
});

describe("reconciliação da predição", () => {
  it("converge para a posição do servidor sem pular", () => {
    let pos = { x: 0, y: 0, z: 0 };
    const server = { x: 1, y: 0, z: 0.5 };
    let snapped = false;
    for (let i = 0; i < 40; i++) {
      const r = reconcilePosition(pos, server);
      snapped ||= r.snapped;
      pos = r.pos;
    }
    expect(snapped).toBe(false);
    expect(Math.hypot(pos.x - server.x, pos.z - server.z)).toBeLessThan(0.01);
  });

  it("erro grande (teleporte) pula direto", () => {
    const r = reconcilePosition({ x: 0, y: 0, z: 0 }, { x: SNAP_DISTANCE + 1, y: 0, z: 0 });
    expect(r.snapped).toBe(true);
    expect(r.pos.x).toBe(SNAP_DISTANCE + 1);
  });

  it("interpola ângulos pelo caminho mais curto", () => {
    const mid = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    expect(Math.abs(Math.abs(mid) - Math.PI)).toBeLessThan(1e-9);
  });
});
