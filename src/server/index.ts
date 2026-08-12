import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Game } from "./game.js";
import { botBrain } from "./bots.js";
import { BALANCE } from "../shared/balance.js";
import type { ClientMsg } from "../shared/protocol.js";

const PORT = Number(process.env.PORT ?? 8080);
const DIST = join(import.meta.dirname, "..", "..", "dist");

const game = new Game(botBrain);

// ===== HTTP estático =====

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    if (path === "/") path = "/index.html";
    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, players: game.players.length, mode: game.round.modeLabel }));
      return;
    }
    const file = normalize(join(DIST, path));
    if (!file.startsWith(DIST)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    if (!existsSync(file)) {
      // SPA fallback
      const idx = join(DIST, "index.html");
      if (!existsSync(idx)) {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end("a-plaga: build em andamento...");
        return;
      }
      const body = await readFile(idx);
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(body);
      return;
    }
    const body = await readFile(file);
    const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end("internal error");
  }
});

// ===== WebSocket =====

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws: WebSocket) => {
  let playerId = -1;
  let joined = false;

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString()) as ClientMsg;
    } catch {
      return;
    }
    if (msg.t === "join") {
      if (joined) return;
      joined = true;
      const name = (msg.d.name ?? "").slice(0, 24).replace(/[<>]/g, "") || "Jogador";
      const send = (m: unknown) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
      };
      playerId = game.addPlayer(name, { send });
      ws.send(
        JSON.stringify({
          t: "welcome",
          d: { id: playerId, snapshot: game.snapshot() },
        }),
      );
    } else if (msg.t === "input") {
      if (!joined) return;
      game.handleInput(playerId, msg.d);
    } else if (msg.t === "buy") {
      if (!joined) return;
      const e = game.players.find((p) => p.id === playerId);
      if (e) game.buyItem(e, msg.d.itemId);
    } else if (msg.t === "selectClass") {
      if (!joined) return;
      game.handleSelectClass(playerId, msg.d.classId);
    } else if (msg.t === "chat") {
      if (!joined) return;
      game.handleChat(playerId, msg.d.text);
    }
  });

  ws.on("close", () => {
    if (playerId >= 0) game.removePlayer(playerId);
  });
});

// ===== Loop do jogo =====

const TICK = 1000 / BALANCE.tickRate;
let last = Date.now();
let started = false;

function loop() {
  const nowMs = Date.now();
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  if (!started) {
    started = true;
    game.startRound();
  }
  game.tick(dt);
  game.ensureBots();
  const snap = game.snapshot();
  for (const ctx of game.clients.values()) {
    ctx.send({ t: "snapshot", d: snap });
  }
  const { fx, kills } = game.drainEvents();
  for (const k of kills) {
    for (const ctx of game.clients.values()) ctx.send({ t: "kill", d: k });
  }
  for (const f of fx) {
    for (const ctx of game.clients.values()) ctx.send({ t: "event", d: f });
  }
}

setInterval(loop, TICK);

server.listen(PORT, () => {
  console.log(`a-plaga listening on :${PORT} (players=${BALANCE.tickRate}tps)`);
});
