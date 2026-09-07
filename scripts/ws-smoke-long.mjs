import { WebSocket } from "ws";

const ws = new WebSocket("ws://localhost:8080/ws");
const seenFx = new Map();
const modes = new Set();
let myId = -1;
let snaps = 0;
let sawTracerFrom = 0;
let sawInvisibleField = 0;
let lastSelf = null;
let errors = [];

ws.on("open", () => {
  ws.send(JSON.stringify({ t: "join", d: { name: "SmokeBot" } }));
});

ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t === "welcome") myId = m.d.id;
  if (m.t === "snapshot") {
    snaps++;
    modes.add(m.d.round.mode + ":" + m.d.round.phase);
    const me = m.d.players.find((p) => p.id === myId);
    if (me) {
      lastSelf = me;
      if (typeof me.invisible === "boolean" && typeof me.reloading === "boolean") sawInvisibleField++;
    }
    for (const p of m.d.players) {
      if (p.hp > p.maxHp) errors.push(`hp>maxHp ${p.name} ${p.hp}/${p.maxHp}`);
      if (!Number.isFinite(p.pos.x) || !Number.isFinite(p.pos.y)) errors.push(`pos NaN ${p.name}`);
    }
    const h = m.d.round.humans, z = m.d.round.zombies;
    if (m.d.round.phase === "hunt" && h === 0 && z === 0) errors.push("round vazio em hunt");
  }
  if (m.t === "event") {
    seenFx.set(m.d.kind, (seenFx.get(m.d.kind) ?? 0) + 1);
    if (m.d.kind === "tracer" && m.d.from) sawTracerFrom++;
  }
  if (m.t === "error") errors.push("server error: " + m.d);
});

// Anda pra frente e atira o tempo todo
let yaw = 0;
setInterval(() => {
  yaw += 0.05;
  ws.send(JSON.stringify({
    t: "input",
    d: { moveX: 0, moveY: 1, jump: false, attack: true, ability: false, crouch: false, yaw, pitch: 0, zoom: false },
  }));
}, 50);

// Troca de classe e compra item no meio
setTimeout(() => ws.send(JSON.stringify({ t: "selectClass", d: { classId: "heavy" } })), 3000);
setTimeout(() => ws.send(JSON.stringify({ t: "buy", d: { itemId: "armor" } })), 4000);
setTimeout(() => ws.send(JSON.stringify({ t: "selectClass", d: { classId: "survivor" } })), 5000);

const DUR = Number(process.argv[2] ?? 60);
setTimeout(() => {
  console.log(JSON.stringify({
    snapshots: snaps,
    fx: Object.fromEntries(seenFx),
    tracersComOrigem: sawTracerFrom,
    camposNovosOk: sawInvisibleField,
    rounds: [...modes],
    self: lastSelf && { team: lastSelf.team, classId: lastSelf.classId, weapon: lastSelf.weapon, hp: lastSelf.hp, maxHp: lastSelf.maxHp, ammo: lastSelf.ammo, reserve: lastSelf.reserve, invisible: lastSelf.invisible, reloading: lastSelf.reloading },
    errors: errors.slice(0, 10),
    errorCount: errors.length,
  }, null, 2));
  process.exit(0);
}, DUR * 1000);
