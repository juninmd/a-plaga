import type { JoinPayload, RoomInfo } from "../shared/protocol";
import { esc } from "./hud";

// ===== Lobby: lista de salas online, criar sala privada, entrar por código/link =====

const $ = (id: string) => document.getElementById(id)!;

export interface LobbyActions {
  /** Pede entrada. O menu só some quando o servidor confirma (welcome). */
  join(payload: Omit<JoinPayload, "name">): void;
}

export function roomLink(code: string): string {
  const u = new URL(location.href);
  u.search = "";
  u.hash = "";
  u.searchParams.set("sala", code);
  return u.toString();
}

/** Código da sala vindo do link (?sala=ABCDE). */
export function roomFromUrl(): string {
  const raw = new URLSearchParams(location.search).get("sala") ?? "";
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function showLobbyError(msg: string) {
  const el = $("lobby-error");
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

const PHASE_LABEL: Record<string, string> = { countdown: "começando", hunt: "em jogo", last_human: "último humano", over: "fim de round" };

async function fetchRooms(): Promise<RoomInfo[]> {
  const res = await fetch("/rooms", { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as RoomInfo[];
}

export function setupLobby(actions: LobbyActions) {
  const list = $("rooms-list");
  let timer = 0;

  const render = (rooms: RoomInfo[]) => {
    if (!rooms.length) {
      list.innerHTML = `<div class="room-empty">Nenhuma sala pública — use JOGAR AGORA.</div>`;
      return;
    }
    list.innerHTML = rooms
      .map((r) => {
        const full = r.players >= r.max;
        return `<div class="room-row">
          <div class="rname">${esc(r.name)}<small>${esc(r.code)} · ${esc(r.mode)} · ${PHASE_LABEL[r.phase] ?? esc(r.phase)}</small></div>
          <div class="rcount${full ? " full" : ""}">${r.players}/${r.max}</div>
          <button class="ghost" data-code="${esc(r.code)}" ${full ? "disabled" : ""}>ENTRAR</button>
        </div>`;
      })
      .join("");
  };

  const refresh = async () => {
    try {
      render(await fetchRooms());
    } catch {
      list.innerHTML = `<div class="room-empty">Servidor indisponível.</div>`;
    }
  };

  list.addEventListener("click", (e) => {
    const code = (e.target as HTMLElement).closest<HTMLElement>("button[data-code]")?.dataset.code;
    if (code) actions.join({ room: code });
  });
  $("rooms-refresh").addEventListener("click", refresh);
  $("create-room-btn").addEventListener("click", () => actions.join({ create: { isPublic: false } }));
  const codeInput = $("room-code-input") as HTMLInputElement;
  const joinCode = () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code) actions.join({ room: code });
  };
  $("join-code-btn").addEventListener("click", joinCode);
  codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinCode();
  });

  const fromUrl = roomFromUrl();
  if (fromUrl) codeInput.value = fromUrl;

  void refresh();
  timer = window.setInterval(() => {
    if (!$("menu").classList.contains("hidden")) void refresh();
  }, 5000);
  return () => clearInterval(timer);
}
