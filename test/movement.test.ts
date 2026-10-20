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

describe("movimento estilo Source", () => {
  const run = (m: MoverState, input: Parameters<typeof stepMovement>[1], steps: number, dt = 1 / 60) => {
    for (let i = 0; i < steps; i++) stepMovement(m, input, dt);
  };
  const hspeed = (m: MoverState) => Math.hypot(m.vel.x, m.vel.z);

  it("atrito para o jogador em pouco tempo ao soltar as teclas", () => {
    const m = mover();
    run(m, { moveX: 0, moveY: 1, jump: false, crouch: false }, 30);
    expect(hspeed(m)).toBeGreaterThan(6);
    run(m, { moveX: 0, moveY: 0, jump: false, crouch: false }, 40);
    expect(hspeed(m)).toBeLessThan(0.01);
  });

  it("pula só na borda de subida (segurar espaço não vira auto-bhop)", () => {
    const m = mover();
    const hold = { moveX: 0, moveY: 0, jump: true, crouch: false };
    run(m, hold, 1);
    expect(m.vel.y).toBeGreaterThan(0);
    let landed = false;
    for (let i = 0; i < 180; i++) {
      stepMovement(m, hold, 1 / 60);
      if (m.onGround) landed = true;
    }
    expect(landed).toBe(true);
    expect(m.pos.y).toBe(0); // pousou e continuou no chão com o espaço segurado
  });

  it("teto anti-bhop: pular com velocidade alta reduz para 1.2x", () => {
    const m = mover();
    m.vel.z = -20;
    run(m, { moveX: 0, moveY: 0, jump: true, crouch: false }, 1);
    expect(hspeed(m)).toBeLessThanOrEqual(BALANCE.baseSpeed * 1.2 + 0.01);
  });

  it("air-strafe: virar e andar de lado no ar ganha velocidade", () => {
    const m = mover();
    m.vel.z = -BALANCE.baseSpeed;
    run(m, { moveX: 0, moveY: 0, jump: true, crouch: false }, 1);
    const before = hspeed(m);
    // gira o yaw ~gradualmente enquanto aperta D (strafe)
    for (let i = 0; i < 30; i++) {
      m.yaw -= 0.03;
      stepMovement(m, { moveX: 1, moveY: 0, jump: false, crouch: false }, 1 / 60);
    }
    expect(hspeed(m)).toBeGreaterThan(before);
    expect(hspeed(m)).toBeLessThanOrEqual(BALANCE.baseSpeed * 2.2 + 0.01);
  });

  it("coyote time: ainda pula logo depois de sair da borda, mas não depois", () => {
    const early = mover();
    early.onGround = false;
    early.airTime = 0.03;
    early.pos.y = 0.5;
    run(early, { moveX: 0, moveY: 0, jump: true, crouch: false }, 1);
    expect(early.vel.y).toBeGreaterThan(3);

    const late = mover();
    late.onGround = false;
    late.airTime = 0.3;
    late.pos.y = 0.5;
    run(late, { moveX: 0, moveY: 0, jump: true, crouch: false }, 1);
    expect(late.vel.y).toBeLessThan(0);
  });
});
