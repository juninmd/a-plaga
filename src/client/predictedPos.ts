import type { Vec3 } from "../shared/protocol";

// Posição do jogador local já prevista (o radar acompanha o frame, não o snapshot de 20 Hz).
let current: Vec3 | null = null;
export function setPredictedPos(p: Vec3) {
  current = p;
}
export function predictedPos(): Vec3 | null {
  return current;
}
