import * as THREE from "three";
import { rottenSkinTexture, tex } from "../textures";
import type { BuiltModel } from "./human";

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.position.set(x, y, z);
  return me;
}
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const S = (r: number, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);

export function makeZombieModel(color: number, classId: string): BuiltModel {
  const g = new THREE.Group();
  const base = new THREE.Color(color);
  const flesh = new THREE.MeshStandardMaterial({ map: tex(`rot${color}`, () => rottenSkinTexture(color)), color: 0xffffff, roughness: 0.95 });
  const rot = new THREE.MeshStandardMaterial({ color: base.clone().multiplyScalar(0.35), roughness: 1 });
  const rags = new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 1 });
  const claw = new THREE.MeshStandardMaterial({ color: 0xd8d4c0, roughness: 0.6 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xe6dfc8, roughness: 0.7 });
  const blood = new THREE.MeshStandardMaterial({ color: 0x7a0a12, roughness: 0.6 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: classId === "nemesis" ? 0xff2020 : 0xe8ff40 });
  const tinted = [rot];
  const fadeable: THREE.Material[] = [flesh, rot, rags, claw, bone, blood, eyeMat];

  const width = classId === "tank" || classId === "nemesis" ? 1.3 : classId === "runner" ? 0.82 : 1;

  // --- Pernas: calça rasgada, joelho dobrado, pés descalços ---
  const mkLeg = (x: number) => {
    const leg = new THREE.Group();
    leg.position.set(x, 0.74, 0);
    leg.rotation.x = -0.25;
    leg.add(mesh(B(0.17, 0.38, 0.19), rags, 0, -0.19, 0));
    const shin = new THREE.Group();
    shin.position.y = -0.38;
    shin.rotation.x = 0.5;
    shin.add(mesh(B(0.14, 0.34, 0.15), flesh, 0, -0.17, 0));
    shin.add(mesh(B(0.16, 0.12, 0.17), rags, 0, -0.04, 0)); // barra rasgada
    shin.add(mesh(B(0.15, 0.08, 0.26), flesh, 0, -0.36, -0.05)); // pé
    leg.add(shin);
    return { leg, shin };
  };
  const L = mkLeg(-0.15 * width);
  const R = mkLeg(0.15 * width);

  // --- Tronco corcunda, inclinado para frente ---
  const upper = new THREE.Group();
  const chest = new THREE.Group();
  chest.position.y = 0.92;
  chest.rotation.x = classId === "runner" ? 0.7 : classId === "tank" ? 0.32 : 0.5;
  upper.add(chest);
  chest.add(mesh(B(0.5 * width, 0.62, 0.3 * width), flesh, 0, 0.24, 0));
  // Costelas expostas
  for (let i = 0; i < 4; i++) {
    const rib = mesh(B(0.3 * width, 0.025, 0.04), bone, 0.02, 0.36 - i * 0.075, -0.16 * width);
    rib.rotation.z = 0.1;
    chest.add(rib);
  }
  chest.add(mesh(B(0.22 * width, 0.28, 0.02), blood, 0.04, 0.22, -0.155 * width)); // ferida aberta
  chest.add(mesh(B(0.44 * width, 0.22, 0.32 * width), rags, 0, 0.02, 0)); // camisa rasgada na cintura
  chest.add(mesh(S(0.22 * width), rot, 0, 0.44, 0.14)); // corcunda
  chest.add(mesh(B(0.16, 0.2, 0.03), blood, -0.14 * width, 0.4, -0.155 * width));

  // --- Cabeça caída, mandíbula aberta, olhos brilhantes ---
  const head = new THREE.Group();
  head.position.set(0, 0.64, -0.14);
  head.rotation.x = 0.3;
  head.add(mesh(B(0.28, 0.27, 0.28), flesh, 0, 0, 0));
  head.add(mesh(B(0.2, 0.09, 0.12), rot, 0, -0.16, -0.1)); // mandíbula
  for (let i = 0; i < 4; i++) head.add(mesh(B(0.025, 0.05, 0.02), bone, -0.06 + i * 0.04, -0.1, -0.15)); // dentes
  head.add(mesh(S(0.04, 6, 6), eyeMat, -0.07, 0.04, -0.14));
  head.add(mesh(S(0.04, 6, 6), eyeMat, 0.07, 0.04, -0.14));
  head.add(mesh(B(0.1, 0.12, 0.02), blood, 0.08, 0.06, -0.145)); // sangue na testa
  chest.add(head);

  // --- Braços longos esticados com garras ---
  const armRest = { l: -1.2, r: -1.2 };
  const mkArm = (x: number, mirror: number) => {
    const arm = new THREE.Group();
    arm.position.set(x, 0.38, -0.08);
    arm.add(mesh(B(0.13, 0.36, 0.14), flesh, 0, -0.17, 0));
    arm.add(mesh(B(0.14, 0.1, 0.15), rags, 0, -0.02, 0)); // manga rasgada
    arm.add(mesh(B(0.11, 0.36, 0.12), flesh, 0, -0.5, 0.02));
    arm.add(mesh(B(0.1, 0.08, 0.14), rot, 0, -0.7, 0)); // mão
    for (let i = -1; i <= 1; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.16, 5), claw);
      c.position.set(i * 0.045, -0.8, -0.03 * mirror);
      c.rotation.x = Math.PI;
      arm.add(c);
    }
    arm.rotation.x = armRest.l;
    arm.rotation.z = mirror * -0.12;
    return arm;
  };
  const armL = mkArm(-0.33 * width, 1);
  const armR = mkArm(0.33 * width, -1);
  chest.add(armL, armR);

  // --- Mutações por classe ---
  switch (classId) {
    case "boomer": {
      const belly = mesh(S(0.44, 10, 8), flesh, 0, 0.12, -0.1);
      belly.scale.set(1, 0.85, 0.9);
      chest.add(belly, mesh(S(0.16), rot, 0, 0.46, 0.16), mesh(S(0.12), rot, 0.18, 0.02, -0.4));
      break;
    }
    case "spitter":
      for (let i = 0; i < 3; i++) chest.add(mesh(S(0.13), rot, (i - 1) * 0.18, 0.34 + Math.abs(i - 1) * 0.08, 0.2));
      {
        const drool = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 6), rot);
        drool.position.set(0, 0.42, -0.32);
        drool.rotation.x = Math.PI;
        chest.add(drool);
      }
      break;
    case "smoker": {
      const tongue = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.02, 0.9, 6), blood);
      tongue.position.set(0, 0.38, -0.55);
      tongue.rotation.x = Math.PI / 2 + 0.2;
      chest.add(tongue);
      for (let i = 0; i < 5; i++) chest.add(mesh(S(0.09, 6, 5), rot, -0.22 + i * 0.12, 0.28 + (i % 2) * 0.16, 0.18));
      break;
    }
    case "tank":
      chest.add(mesh(S(0.27), flesh, -0.38, 0.4, 0), mesh(S(0.27), flesh, 0.38, 0.4, 0));
      chest.add(mesh(B(0.7, 0.3, 0.4), rags, 0, -0.05, 0));
      break;
    case "witch":
      chest.add(mesh(B(0.36, 0.5, 0.18), rags, 0, 0.62, 0.04)); // cabelo comprido
      for (const arm of [armL, armR])
        for (const child of arm.children) if (child instanceof THREE.Mesh && child.geometry instanceof THREE.ConeGeometry) child.scale.setScalar(2.2);
      break;
    case "runner":
      chest.children.forEach((c) => { if (c instanceof THREE.Mesh && c.geometry instanceof THREE.SphereGeometry) c.visible = false; });
      break;
    case "nemesis": {
      for (let i = 0; i < 6; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 5), claw);
        spike.position.set(-0.3 + i * 0.12, 0.42 + (i % 2) * 0.12, 0.2);
        spike.rotation.x = -0.6;
        chest.add(spike);
      }
      chest.add(mesh(B(0.6, 0.36, 0.06), rot, 0, 0.22, -0.19)); // placa óssea
      head.add(mesh(B(0.34, 0.1, 0.34), rot, 0, 0.14, 0));
      break;
    }
  }

  g.add(L.leg, R.leg, upper);
  return { group: g, upper, legL: L.leg, legR: R.leg, shinL: L.shin, shinR: R.shin, armL, armR, tinted, fadeable, armRest };
}
