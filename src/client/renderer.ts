import * as THREE from "three";
import { MAP } from "../shared/map";
import type { PickupState, PlayerState, ProjectileState } from "../shared/protocol";

interface RenderedPlayer {
  group: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  nameTag: THREE.Sprite;
  glow: THREE.Mesh;
  target: PlayerState;
  curScale: number;
}

export class Renderer {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  private players = new Map<number, RenderedPlayer>();
  private pickups = new Map<number, THREE.Mesh>();
  private projectiles = new Map<number, THREE.Group>();
  private boxMeshes: THREE.Mesh[] = [];
  private tracers: { mesh: THREE.Mesh; until: number }[] = [];
  private particles: { mesh: THREE.Mesh; vel: THREE.Vector3; until: number }[] = [];
  private sky: THREE.Mesh;
  clock = new THREE.Clock();
  localId = -1;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.getElementById("app")!.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 400);

    // Sky — céu escuro de horror
    this.scene.background = new THREE.Color(0x0d1412);
    this.scene.fog = new THREE.Fog(0x0d1412, 90, 200);

    const hemi = new THREE.HemisphereLight(0x4a5d55, 0x0a0f0d, 0.7);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.1);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    this.scene.add(sun);

    this.buildMap();

    // Sky sphere sutil
    const skyGeo = new THREE.SphereGeometry(180, 24, 12);
    const skyMat = new THREE.MeshBasicMaterial({ color: 0x101a16, side: THREE.BackSide, fog: false });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.scene.add(this.sky);

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private buildMap() {
    // Chão
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP.size.x * 2, MAP.size.z * 2),
      new THREE.MeshStandardMaterial({ color: MAP.floor.color, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Grid decorativo
    const grid = new THREE.GridHelper(MAP.size.x * 2, 24, 0x556655, 0x334433);
    grid.position.y = 0.02;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.scene.add(grid);

    // Caixas (obstáculos)
    for (const b of MAP.boxes) {
      const w = b.max.x - b.min.x;
      const h = b.max.y - b.min.y;
      const d = b.max.z - b.min.z;
      const isWall = h > 4;
      const mat = new THREE.MeshStandardMaterial({
        color: isWall ? 0x6d6d5e : 0x7a5c3e,
        roughness: 0.85,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set((b.min.x + b.max.x) / 2, h / 2, (b.min.z + b.max.z) / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.boxMeshes.push(mesh);
      // Arestas sutis
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: 0x222822 }),
      );
      edges.position.copy(mesh.position);
      this.scene.add(edges);
    }
  }

  // ===== Players =====

  private makePlayerMesh(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.32, 0.6, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0x4caf50, roughness: 0.7 }),
    );
    body.position.y = 0.9;
    body.castShadow = true;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x7caf7c, roughness: 0.6 }),
    );
    head.position.y = 1.55;
    head.castShadow = true;
    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.5, 4, 8), body.material);
    armL.position.set(-0.35, 1.05, 0.1);
    const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.5, 4, 8), body.material);
    armR.position.set(0.35, 1.05, 0.1);
    g.add(body, head, armL, armR);

    // Glow (invisível por padrão)
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0x00e676,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    glow.position.y = 0.9;
    g.add(glow);

    // Name tag
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 28px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText("???", 128, 36);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.scale.set(2.4, 0.6, 1);
    sprite.position.y = 2.4;
    g.add(sprite);

    return g;
  }

  upsertPlayer(p: PlayerState) {
    let rp = this.players.get(p.id);
    if (!rp) {
      const group = this.makePlayerMesh();
      this.scene.add(group);
      rp = {
        group,
        body: group.children[0] as THREE.Mesh,
        head: group.children[1] as THREE.Mesh,
        armL: group.children[2] as THREE.Mesh,
        armR: group.children[3] as THREE.Mesh,
        glow: group.children[4] as THREE.Mesh,
        nameTag: group.children[5] as THREE.Sprite,
        target: p,
        curScale: 1,
      };
      this.players.set(p.id, rp);
    }
    rp.target = p;
    const isZombie = p.team === "zombie";
    (rp.body.material as THREE.MeshStandardMaterial).color.setHex(p.color);
    (rp.head.material as THREE.MeshStandardMaterial).color.setHex(p.color);
    (rp.glow.material as THREE.MeshBasicMaterial).color.setHex(p.color);
    rp.group.visible = p.alive;
    if (!p.alive) return;

    // Invisibilidade (fantasma) — só afeta inimigos, simplificado: alpha baixo
    const invisible = p.classId === "ghost";
    (rp.body.material as THREE.MeshStandardMaterial).transparent = invisible;
    (rp.head.material as THREE.MeshStandardMaterial).transparent = invisible;
    (rp.body.material as THREE.MeshStandardMaterial).opacity = invisible ? 0.2 : 1;
    (rp.head.material as THREE.MeshStandardMaterial).opacity = invisible ? 0.2 : 1;

    // Boss glow
    const glowMat = rp.glow.material as THREE.MeshBasicMaterial;
    if (p.isBoss) {
      glowMat.opacity = 0.25 + Math.sin(this.clock.elapsedTime * 4) * 0.1;
      glowMat.color.setHex(p.team === "zombie" ? 0xff1744 : 0x29b6f6);
    } else if (p.team === "zombie") {
      glowMat.opacity = 0.12;
      glowMat.color.setHex(0x00e676);
    } else {
      glowMat.opacity = 0;
    }

    // Nome + boss
    const canvas = rp.nameTag.material.map?.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = isZombie ? "#7be07f" : "#7fd0ff";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 6;
    const label = p.isBoss ? `★ ${p.name}` : p.name;
    ctx.fillText(label, 128, 36);
    rp.nameTag.material.map!.needsUpdate = true;
  }

  removePlayer(id: number) {
    const rp = this.players.get(id);
    if (rp) {
      this.scene.remove(rp.group);
      this.players.delete(id);
    }
  }

  playerIds(): number[] {
    return [...this.players.keys()];
  }

  updatePlayerVisuals(dt: number) {
    const t = performance.now() / 1000;
    for (const rp of this.players.values()) {
      const p = rp.target;
      // Suavização
      const lerp = 1 - Math.exp(-10 * dt);
      rp.group.position.lerp(
        new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z),
        lerp,
      );
      // Interpolação de escala
      rp.curScale += (p.scale - rp.curScale) * lerp;
      rp.group.scale.setScalar(rp.curScale);
      rp.group.rotation.y = p.yaw;
      if (p.team === "human") {
        // Arma na mão direita aponta para frente
        const w = p.weapon;
        rp.armR.rotation.x = w === "shotgun" ? -1.4 : -1.2;
        rp.armL.rotation.x = w === "shotgun" ? -1.4 : -0.4;
      } else {
        // Braços esticados — garra
        rp.armR.rotation.x = 0.4;
        rp.armL.rotation.x = 0.4;
      }
      // Pulo leve
      rp.group.position.y = p.pos.y;
      // Bôbos respirando
      const breathe = Math.sin(t * 3 + p.id) * 0.02;
      rp.group.position.y += breathe;
    }
  }

  // ===== Pickups =====

  upsertPickups(pickups: PickupState[]) {
    const seen = new Set<number>();
    for (const pk of pickups) {
      seen.add(pk.id);
      let mesh = this.pickups.get(pk.id);
      if (!mesh) {
        const geo = new THREE.OctahedronGeometry(0.25);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00e676 });
        mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 0.6;
        this.scene.add(mesh);
        this.pickups.set(pk.id, mesh);
      }
      mesh.position.set(pk.pos.x, pk.pos.y, pk.pos.z);
      mesh.rotation.y += 0.05;
    }
    for (const [id, mesh] of this.pickups) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.pickups.delete(id);
      }
    }
  }

  // ===== Projéteis =====

  upsertProjectiles(projs: ProjectileState[]) {
    const seen = new Set<number>();
    for (const pr of projs) {
      seen.add(pr.id);
      let g = this.projectiles.get(pr.id);
      if (!g) {
        g = new THREE.Group();
        const mat = new THREE.MeshBasicMaterial({
          color:
            pr.kind === "fire_grenade" ? 0xff6d00 : pr.kind === "frost_grenade" ? 0x4fc3f7 : pr.kind === "pipebomb" ? 0x333 : 0x9ccc65,
        });
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), mat);
        m.castShadow = true;
        g.add(m);
        // Trail
        const trail = new THREE.Mesh(
          new THREE.SphereGeometry(0.05, 4, 4),
          new THREE.MeshBasicMaterial({ color: mat.color, transparent: true, opacity: 0.5 }),
        );
        g.add(trail);
        this.scene.add(g);
        this.projectiles.set(pr.id, g);
      }
      g.position.set(pr.pos.x, pr.pos.y, pr.pos.z);
    }
    for (const [id, g] of this.projectiles) {
      if (!seen.has(id)) {
        this.scene.remove(g);
        this.projectiles.delete(id);
      }
    }
  }

  // ===== Efeitos =====

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, len, 4),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
    );
    mesh.position.copy(from).add(dir.clone().multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.scene.add(mesh);
    this.tracers.push({ mesh, until: performance.now() + 60 });
  }

  explosion(pos: THREE.Vector3, color: number, radius: number) {
    // Flash
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.25, 8, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
    );
    flash.position.copy(pos);
    this.scene.add(flash);
    this.tracers.push({ mesh: flash, until: performance.now() + 100 });
    // Partículas
    const n = 14;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 4, 4),
        new THREE.MeshBasicMaterial({ color: i % 2 ? color : 0x222222 }),
      );
      m.position.copy(pos);
      this.scene.add(m);
      this.particles.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2).multiplyScalar(radius),
        until: performance.now() + 500,
      });
    }
    this.lightFlash(pos, color, radius * 3);
  }

  private lightFlash(pos: THREE.Vector3, color: number, intensity: number) {
    const light = new THREE.PointLight(color, intensity, 30);
    light.position.copy(pos);
    this.scene.add(light);
    setTimeout(() => this.scene.remove(light), 120);
  }

  damageNumber(pos: THREE.Vector3, value: number, headshot: boolean) {
    const el = document.createElement("div");
    el.className = "dmg" + (headshot ? " headshot" : " hit");
    el.textContent = String(Math.round(value));
    const center = document.getElementById("damage-numbers")!;
    const v = pos.clone().project(this.camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty("--dx", `${(Math.random() - 0.5) * 60}px`);
    center.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  updateEffects(dt: number) {
    const nowMs = performance.now();
    this.tracers = this.tracers.filter((t) => {
      if (nowMs > t.until) {
        this.scene.remove(t.mesh);
        return false;
      }
      return true;
    });
    this.particles = this.particles.filter((p) => {
      if (nowMs > p.until) {
        this.scene.remove(p.mesh);
        return false;
      }
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.y -= 6 * dt;
      return true;
    });
  }

  setLocalCamera(pos: THREE.Vector3, yaw: number, pitch: number) {
    this.camera.position.copy(pos);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = yaw;
    this.camera.rotation.x = pitch;
    this.sky.position.copy(this.camera.position);
  }

  frame(cb: () => void) {
    const dt = this.clock.getDelta();
    this.updateEffects(dt);
    this.updatePlayerVisuals(dt);
    cb();
    this.renderer.render(this.scene, this.camera);
  }
}

export function createRenderer(): Renderer {
  return new Renderer();
}
