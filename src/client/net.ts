import type { ClientMsg, ServerMsg } from "../shared/protocol";

export type Handler = (msg: ServerMsg) => void;
export type StatusHandler = (connected: boolean) => void;

export class Net {
  ws: WebSocket | null = null;
  private handler: Handler | null = null;
  private statusHandler: StatusHandler | null = null;
  connected = false;
  reconnectTimer: number | null = null;

  connect(onMsg: Handler, onStatus?: StatusHandler) {
    this.handler = onMsg;
    this.statusHandler = onStatus ?? null;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/ws`;
    this.open(url);
  }

  private open(url: string) {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.statusHandler?.(true);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerMsg;
        this.handler?.(msg);
      } catch {
        /* mensagem malformada — ignora */
      }
    };
    ws.onclose = () => {
      this.connected = false;
      this.statusHandler?.(false);
      if (this.reconnectTimer == null) {
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          this.open(url);
        }, 3000);
      }
    };
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

export const net = new Net();
