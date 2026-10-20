import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Lobby, MAIN_ROOM, type Room } from "./lobby.js";
import { botBrain } from "./bots.js";
import { BALANCE } from "../shared/balance.js";
import type { ClientMsg, InputState, JoinPayload } from "../shared/protocol.js";

const PORT = Number(process.env.PORT ?? 8080);
const DIST = join(import.meta.dirname, "..", "..", "dist");

const lobby = new Lobby(botBrain);

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
  ".glb": "model/gltf-binary",
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    if (path === "/") path = "/index.html";
    if (path === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      const rooms = lobby.all();
      res.end(JSON.stringify({ ok: true, rooms: rooms.length, players: rooms.reduce((n, r) => n + r.humans, 0) }));
      return;
    }
    if (path === "/rooms") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(lobby.list()));
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

const MAX_MSG_BYTES = 4096;
const INPUT_PER_SEC = 90;
const CHAT_MIN_GAP_MS = 600;
const HEARTBEAT_MS = 15_000;

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: MAX_MSG_BYTES });

interface Conn extends WebSocket {
  isAlive?: boolean;
}

const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP ?? 8);
const MAX_CONN_TOTAL = Number(process.env.MAX_CONN_TOTAL ?? 300);
const connsByIp = new Map<string, number>();

/** IP real do cliente: atrás de proxy/ingress (Traefik, Fly, Render) vem em X-Forwarded-For. */
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "?";
}

wss.on("connection", (ws: Conn, req: IncomingMessage) => {
  // Limite por IP e total: um cliente (ou script) não derruba o servidor abrindo milhares de sockets
  const ip = clientIp(req);
  const open = connsByIp.get(ip) ?? 0;
  if (open >= MAX_CONN_PER_IP || wss.clients.size > MAX_CONN_TOTAL) {
    ws.close(1013, "too many connections");
    return;
  }
  connsByIp.set(ip, open + 1);
  ws.on("close", () => {
    const n = (connsByIp.get(ip) ?? 1) - 1;
    if (n <= 0) connsByIp.delete(ip);
    else connsByIp.set(ip, n);
  });

  let playerId = -1;
  let room: Room | null = null;
  let joined = false;
  let windowStart = Date.now();
  let windowCount = 0;
  let lastChat = 0;
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  const send = (m: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  /** Token bucket simples: cliente malicioso não consegue afogar a sala com mensagens. */
  const allowed = (): boolean => {
    const t = Date.now();
    if (t - windowStart >= 1000) {
      windowStart = t;
      windowCount = 0;
    }
    return ++windowCount <= INPUT_PER_SEC;
  };

  ws.on("message", (raw) => {
    if (!allowed()) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString()) as ClientMsg;
    } catch {
      return;
    }
    // Mensagem malformada não pode derrubar o processo inteiro (todos os jogadores caem junto)
    try {
      dispatch(msg);
    } catch (err) {
      console.error("mensagem inválida de", playerId, err instanceof Error ? err.message : err);
    }
  });

  const join = (d: Partial<JoinPayload> | undefined) => {
    const rawName = d?.name;
    const name = (typeof rawName === "string" ? rawName : "").trim().slice(0, 24).replace(/[<>]/g, "") || "Jogador";
    let target: Room | null | undefined;
    if (d?.create && typeof d.create === "object") {
      target = lobby.createRoom(String(d.create.name ?? ""), d.create.isPublic === true);
      if (!target) return send({ t: "error", d: "Limite de salas atingido, tente mais tarde." });
    } else if (typeof d?.room === "string" && d.room.trim()) {
      target = lobby.get(d.room);
      if (!target) return send({ t: "error", d: `Sala ${d.room.trim().toUpperCase().slice(0, 8)} não existe.` });
    } else {
      target = lobby.quickPlay();
      if (!target) return send({ t: "error", d: "Sem salas disponíveis." });
    }
    if (target.full) return send({ t: "error", d: "Sala cheia." });
    joined = true;
    room = target;
    const r = target;
    r.exec((g) => {
      r.makeRoomForHuman();
      playerId = g.addPlayer(name, { send });
      send({ t: "welcome", d: { id: playerId, snapshot: g.snapshot(), room: r.info() } });
      // Quem entra no meio do round precisa ver o AP inicial sem esperar o próximo evento
      send({ t: "shop", d: { ap: g.getAp(playerId), owned: [] } });
    });
  };

  const dispatch = (msg: ClientMsg) => {
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
    const d = (msg as { d?: unknown }).d;
    if (msg.t === "ping") {
      const c = Number((d as { c?: unknown } | undefined)?.c);
      if (Number.isFinite(c)) send({ t: "pong", d: { c } });
      return;
    }
    if (msg.t === "join") {
      if (joined) return;
      join(d as Partial<JoinPayload> | undefined);
      return;
    }
    if (!joined || !room) return;
    room.exec((game) => {
      if (msg.t === "input") {
        if (d && typeof d === "object") game.handleInput(playerId, d as InputState);
      } else if (msg.t === "buy") {
        const e = game.players.find((p) => p.id === playerId);
        if (e) game.buyItem(e, String((d as { itemId?: unknown } | undefined)?.itemId ?? ""));
      } else if (msg.t === "buyWeapon") {
        game.handleBuyWeapon(playerId, String(msg.d?.weaponId ?? ""));
      } else if (msg.t === "switch") {
        const slot = Number(msg.d?.slot);
        if (slot === 1 || slot === 2 || slot === 3) game.handleSwitch(playerId, slot);
      } else if (msg.t === "reload") {
        game.handleReload(playerId);
      } else if (msg.t === "selectClass") {
        game.handleSelectClass(playerId, String((d as { classId?: unknown } | undefined)?.classId ?? ""));
      } else if (msg.t === "chat") {
        const text = (d as { text?: unknown } | undefined)?.text;
        const t = Date.now();
        if (typeof text === "string" && t - lastChat >= CHAT_MIN_GAP_MS) {
          lastChat = t;
          game.handleChat(playerId, text);
        }
      }
    });
  };

  ws.on("close", () => {
    if (room && playerId >= 0) {
      const r = room;
      r.exec((g) => g.removePlayer(playerId));
    }
  });
  ws.on("error", () => ws.terminate());
});

// Conexão que sumiu sem fechar (Wi-Fi caiu, celular dormiu) libera a vaga em vez de virar fantasma
setInterval(() => {
  for (const ws of wss.clients as Set<Conn>) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

// ===== Loop do jogo =====

const TICK = 1000 / BALANCE.tickRate;
let last = Date.now();

setInterval(() => {
  const nowMs = Date.now();
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  lobby.tick(dt);
}, TICK);

server.listen(PORT, () => {
  console.log(`a-plaga listening on :${PORT} (${BALANCE.tickRate} tps) — sala principal: ${MAIN_ROOM}`);
});
