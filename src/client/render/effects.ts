import * as THREE from "three";
import { IS_MOBILE, bloodSplatTexture, bulletHoleTexture, smokeTexture, tex } from "./textures";

// ===== Efeitos: tracers, impactos, decalques, sangue, explosões, punch/shake de câmera =====

interface Particle {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  until: number;
  born: number;
  gravity: number;
  grow?: number;
  fade?: boolean;
}

class DecalPool {
  private items: THREE.Mesh[] = [];
  private next = 0;
  constructor(scene: THREE.Scene, map: THREE.Texture, size: number, max: number) {
    const geo = new THREE.PlaneGeometry(size, size);
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.items.push(m);
    }
  }
  place(pos: THREE.Vector3, normal: THREE.Vector3, scale = 1) {
    const m = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    m.visible = true;
    m.position.copy(pos).addScaledVector(normal, 0.01);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(scale);
  }
}

export class Effects {
  private tracers: { mesh: THREE.Mesh; until: number }[] = [];
  private particles: Particle[] = [];
  private lights: { light: THREE.PointLight; until: number }[] = [];
  private holes: DecalPool;
  private splats: DecalPool;
  private smokeMat: THREE.SpriteMaterial;
  private sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd27f });
  private dustMat = new THREE.MeshBasicMaterial({ color: 0xc9b08a, transparent: true, opacity: 0.6 });
  private bloodMat = new THREE.MeshBasicMaterial({ color: 0x8a0f14 });
  private debrisMat = new THREE.MeshBasicMaterial({ color: 0x2a2420 });
  private tracerMat = new Map<number, THREE.MeshBasicMaterial>();
  private sparkGeo = new THREE.BoxGeometry(0.03, 0.03, 0.12);
  private dropGeo = new THREE.SphereGeometry(0.05, 4, 3);
  private debrisGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  // Punch (recuo) e shake da câmera
  private punchPitch = 0;
  private punchYaw = 0;
  private shakeAmt = 0;
  private shakeT = 0;

  constructor(private scene: THREE.Scene) {
    this.holes = new DecalPool(scene, tex("hole", bulletHoleTexture), 0.22, IS_MOBILE ? 24 : 64);
    this.splats = new DecalPool(scene, tex("splat", bloodSplatTexture), 1.1, IS_MOBILE ? 12 : 32);
    this.smokeMat = new THREE.SpriteMaterial({ map: tex("smoke", smokeTexture), color: 0x6a6058, transparent: true, opacity: 0.55, depthWrite: false });
  }

  private spawn(mesh: THREE.Object3D, vel: THREE.Vector3, life: number, gravity: number, extra?: Partial<Particle>) {
    this.scene.add(mesh);
    const born = performance.now();
    this.particles.push({ mesh, vel, until: born + life, born, gravity, ...extra });
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 0.1) return;
    let mat = this.tracerMat.get(color);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xfff2c0), 0.6), transparent: true, opacity: 0.75, fog: false });
      this.tracerMat.set(color, mat);
    }
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 3), mat);
    mesh.position.copy(from).add(dir.clone().multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.scene.add(mesh);
    this.tracers.push({ mesh, until: performance.now() + 50 });
  }

  impact(pos: THREE.Vector3, normal: THREE.Vector3) {
    this.holes.place(pos, normal, 0.8 + Math.random() * 0.5);
    const n = IS_MOBILE ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      m.position.copy(pos);
      const v = normal.clone().multiplyScalar(2 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3));
      m.lookAt(pos.clone().add(v));
      this.spawn(m, v, 180 + Math.random() * 120, 12);
    }
    // Poeira
    for (let i = 0; i < (IS_MOBILE ? 1 : 3); i++) {
      const m = new THREE.Mesh(this.dropGeo, this.dustMat);
      m.position.copy(pos).addScaledVector(normal, 0.05);
      m.scale.setScalar(1.5);
      this.spawn(m, normal.clone().multiplyScalar(0.6).add(new THREE.Vector3((Math.random() - 0.5), 0.4, (Math.random() - 0.5))), 350, 0.5, { grow: 6, fade: true });
    }
  }

  blood(pos: THREE.Vector3, amount: number) {
    const n = Math.min(IS_MOBILE ? 6 : 14, 3 + Math.round(amount / 12));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.dropGeo, this.bloodMat);
      m.position.copy(pos);
      m.scale.setScalar(0.6 + Math.random());
      this.spawn(m, new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4), 400 + Math.random() * 300, 12);
    }
    if (Math.random() < 0.6) {
      const ground = new THREE.Vector3(pos.x + (Math.random() - 0.5) * 0.8, 0.02, pos.z + (Math.random() - 0.5) * 0.8);
      this.splats.place(ground, new THREE.Vector3(0, 1, 0), 0.6 + Math.random() * 0.8 + amount / 100);
    }
  }

  explosion(pos: THREE.Vector3, color: number, radius: number) {
    const flash = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.3, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, fog: false }));
    flash.position.copy(pos);
    this.spawn(flash, new THREE.Vector3(), 140, 0, { grow: 12, fade: true });
    const n = IS_MOBILE ? 8 : 18;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.debrisGeo, i % 3 ? this.debrisMat : new THREE.MeshBasicMaterial({ color }));
      m.position.copy(pos);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this.spawn(m, new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.6 + 0.4, (Math.random() - 0.5) * 2).multiplyScalar(radius * 1.6), 600 + Math.random() * 400, 14);
    }
    for (let i = 0; i < (IS_MOBILE ? 3 : 7); i++) {
      const s = new THREE.Sprite(this.smokeMat.clone());
      s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * radius * 0.6, Math.random() * radius * 0.5, (Math.random() - 0.5) * radius * 0.6));
      s.scale.setScalar(radius * 0.5);
      this.spawn(s, new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.2 + Math.random(), (Math.random() - 0.5) * 1.5), 1400 + Math.random() * 600, -0.3, { grow: radius * 0.9, fade: true });
    }
    this.lightFlash(pos, color, radius * 4, 30);
    this.splats.place(new THREE.Vector3(pos.x, 0.02, pos.z), new THREE.Vector3(0, 1, 0), radius * 0.5);
  }

  /** Materiais/geometrias criados por efeito (flash, fumaça clonada, destroço colorido) precisam ser liberados. */
  private releaseParticle(obj: THREE.Object3D) {
    const m = obj as THREE.Mesh | THREE.Sprite;
    const mat = m.material as THREE.Material | undefined;
    const sharedMats: THREE.Material[] = [this.debrisMat, this.smokeMat, this.sparkMat, this.dustMat, this.bloodMat];
    if (mat && !sharedMats.includes(mat)) mat.dispose();
    const geo = (m as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const sharedGeos: THREE.BufferGeometry[] = [this.debrisGeo, this.sparkGeo, this.dropGeo];
    if (geo && !sharedGeos.includes(geo) && !(obj instanceof THREE.Sprite)) geo.dispose();
  }

  lightFlash(pos: THREE.Vector3, color: number, intensity: number, distance: number) {
    if (IS_MOBILE) return;
    const light = new THREE.PointLight(color, intensity, distance);
    light.position.copy(pos);
    this.scene.add(light);
    this.lights.push({ light, until: performance.now() + 120 });
  }

  punch(pitch: number, yaw: number) {
    this.punchPitch += pitch;
    this.punchYaw += yaw;
  }

  shake(intensity: number) {
    this.shakeAmt = Math.min(1, this.shakeAmt + intensity);
  }

  /** Deslocamento de rotação da câmera neste frame (pitch, yaw, roll). */
  cameraOffset(dt: number): [number, number, number] {
    this.punchPitch *= Math.exp(-9 * dt);
    this.punchYaw *= Math.exp(-9 * dt);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.2);
    this.shakeT += dt * 60;
    const s = this.shakeAmt * this.shakeAmt * 0.05;
    return [
      this.punchPitch + Math.sin(this.shakeT * 1.3) * s,
      this.punchYaw + Math.cos(this.shakeT * 1.7) * s,
      Math.sin(this.shakeT * 0.9) * s * 0.6,
    ];
  }

  update(dt: number) {
    const nowMs = performance.now();
    this.tracers = this.tracers.filter((t) => {
      if (nowMs > t.until) { this.scene.remove(t.mesh); t.mesh.geometry.dispose(); return false; }
      return true;
    });
    this.lights = this.lights.filter((l) => {
      if (nowMs > l.until) { this.scene.remove(l.light); return false; }
      l.light.intensity *= 0.8;
      return true;
    });
    this.particles = this.particles.filter((p) => {
      if (nowMs > p.until) { this.scene.remove(p.mesh); this.releaseParticle(p.mesh); return false; }
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.y -= p.gravity * dt;
      if (p.mesh.position.y < 0.02 && p.gravity > 0) { p.mesh.position.y = 0.02; p.vel.set(0, 0, 0); }
      if (p.grow) p.mesh.scale.addScalar(p.grow * dt);
      if (p.fade) {
        const life = (nowMs - p.born) / (p.until - p.born);
        const mat = (p.mesh as THREE.Mesh).material as THREE.Material & { opacity: number };
        mat.opacity = Math.max(0, (1 - life) * 0.7);
      }
      return true;
    });
  }
}
