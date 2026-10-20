import type { ClientMsg, JoinPayload, ServerMsg } from "../shared/protocol";

export type Handler = (msg: ServerMsg) => void;
export type StatusHandler = (connected: boolean) => void;

const PING_EVERY_MS = 2000;

export class Net {
  ws: WebSocket | null = null;
  private handler: Handler | null = null;
  private statusHandler: StatusHandler | null = null;
  connected = false;
  reconnectTimer: number | null = null;
  /** Latência de ida e volta, suavizada (ms). -1 = ainda sem medida. */
  ping = -1;
  /** Código da sala em que estou (usado para voltar à mesma sala depois de uma queda). */
  roomCode = "";
  private lastJoin: JoinPayload | null = null;
  private retries = 0;
  private pingTimer: number | null = null;

  connect(onMsg: Handler, onStatus?: StatusHandler) {
    this.handler = onMsg;
    this.statusHandler = onStatus ?? null;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws`;
    this.open(url);
  }

  /** Entra numa sala (ou cria/“jogar agora”). Guarda o pedido para reentrar sozinho se a conexão cair. */
  join(payload: JoinPayload) {
    this.lastJoin = payload;
    // Conexão ainda abrindo: o onopen entrega o pedido
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: "join", d: payload }));
  }

  /** Entrada recusada (sala cheia/inexistente): não reenviar o mesmo pedido a cada reconexão. */
  clearJoin() {
    this.lastJoin = null;
  }

  /** Chamado quando o servidor confirma a entrada: reconexões voltam para ESTA sala, não para outra. */
  onWelcome(roomCode: string) {
    this.roomCode = roomCode;
    if (this.lastJoin) this.lastJoin = { name: this.lastJoin.name, room: roomCode };
  }

  private open(url: string) {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retries = 0;
      this.statusHandler?.(true);
      // Reconexão: volta para a mesma sala sem o jogador precisar fazer nada
      if (this.lastJoin) ws.send(JSON.stringify({ t: "join", d: this.lastJoin }));
      this.startPing();
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMsg;
        if (msg.t === "pong") {
          const rtt = performance.now() - msg.d.c;
          this.ping = this.ping < 0 ? rtt : this.ping * 0.7 + rtt * 0.3;
          return;
        }
        this.handler?.(msg);
      } catch {
        /* mensagem malformada — ignora */
      }
    };
    ws.onclose = () => {
      this.connected = false;
      this.ping = -1;
      this.stopPing();
      this.statusHandler?.(false);
      if (this.reconnectTimer == null) {
        // Backoff exponencial (1s, 2s, 4s… até 8s) para não martelar o servidor
        const delay = Math.min(8000, 1000 * 2 ** this.retries++);
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.open(url);
        }, delay);
      }
    };
  }

  private startPing() {
    this.stopPing();
    const tick = () => this.ws?.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify({ t: "ping", d: { c: performance.now() } }));
    tick();
    this.pingTimer = window.setInterval(tick, PING_EVERY_MS);
  }

  private stopPing() {
    if (this.pingTimer != null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

export const net = new Net();
