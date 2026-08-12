// Smoke test do WebSocket: join -> input -> snapshot -> kill -> round
import WebSocket from "ws";

const ws = new WebSocket("ws://localhost:8080/ws");
let gotSnapshot = false;
let gotKill = false;
let gotRound = false;
let id = -1;

ws.on("open", () => {
  ws.send(JSON.stringify({ t: "join", d: { name: "SmokeTest" } }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === "welcome") {
    id = msg.d.id;
    console.log("WELCOME id=", id);
    // Envia input continuamente: andar para frente + atirar
    setInterval(() => {
      ws.send(JSON.stringify({ t: "input", d: { moveX: 0, moveY: 1, jump: false, attack: true, ability: false, yaw: 0, pitch: 0, zoom: false } }));
    }, 50);
    setTimeout(() => ws.send(JSON.stringify({ t: "buy", d: { itemId: "adrenaline" } })), 1000);
    setTimeout(() => ws.send(JSON.stringify({ t: "chat", d: { text: "olá praga" } })), 2000);
    setTimeout(() => ws.send(JSON.stringify({ t: "selectClass", d: { classId: "heavy" } })), 3000);
  }
  if (msg.t === "snapshot") {
    if (!gotSnapshot) {
      gotSnapshot = true;
      const me = msg.d.players.find((p) => p.id === id);
      console.log("SNAPSHOT players=", msg.d.players.length, "me=", me?.name, me?.team, "mode=", msg.d.round.modeLabel, "phase=", msg.d.round.phase);
    }
  }
  if (msg.t === "kill") {
    gotKill = true;
    console.log("KILL:", msg.d.killer, "->", msg.d.victim, msg.d.weapon);
  }
  if (msg.t === "roundStart") {
    gotRound = true;
    console.log("ROUND:", msg.d.modeLabel, msg.d.phase);
  }
  if (msg.t === "chat") {
    console.log("CHAT:", msg.d.name, ":", msg.d.text);
  }
  if (msg.t === "event") {
    console.log("FX:", msg.d.kind);
  }
});

setTimeout(() => {
  console.log("RESULT:", JSON.stringify({ gotSnapshot, gotKill, gotRound }));
  ws.close();
  process.exit(gotSnapshot && gotRound ? 0 : 1);
}, 30000);
