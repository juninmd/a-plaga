import { BALANCE, MODES, MODE_INDEX } from "../shared/balance.js";
import type { GameMode, Team } from "../shared/protocol.js";
import { infect } from "./combat.js";
import type { Game } from "./game.js";
import { narrate } from "./narrator.js";
import type { Entity } from "./physics.js";

function shuffle<T>(list: T[]): T[] {
  return [...list].sort(() => Math.random() - 0.5);
}

function chooseMode(g: Game): GameMode {
  // Sem repetir modo consecutivo (zp_prevent_consecutive_modes)
  let best: GameMode = "infection";
  let bestScore = 0;
  for (const m of MODES) {
    if (m.id === g.lastMode) continue;
    const score = Math.random() / m.chance;
    if (score > bestScore) {
      bestScore = score;
      best = m.id;
    }
  }
  return best;
}

export function startRound(g: Game) {
  g.roundNumber++;
  const mode = chooseMode(g);
  g.lastMode = mode;
  g.round = {
    mode,
    phase: "countdown",
    timeLeft: BALANCE.countdownTime,
    zombies: 0,
    humans: 0,
    firstZombie: "",
    modeLabel: MODE_INDEX[mode].label,
    number: g.roundNumber,
  };
  g.pickups = [];
  g.projectiles = [];
  g.announcedLastZombie = false;

  // Todo round começa com todos humanos; cada modo redistribui os times depois.
  const all = g.players;
  for (const p of all) {
    p.team = "human";
    p.isBoss = false;
    p.alive = true;
    p.kills = 0;
    p.streak = 0;
    p.infections = 0;
    g.spawnAtRandom(p);
    g.sendTo(p.id, { t: "shop", d: { ap: g.getAp(p.id), owned: [...g.owned.get(p.id)!] } });
  }
  const humans = all.filter((p) => p.team === "human");

  const makeBoss = (p: Entity, cls: "nemesis" | "survivor") => {
    if (cls === "nemesis" && p.team !== "zombie") infect(g, p, null, false);
    g.applyClass(p, cls);
    p.isBoss = true;
    g.spawnAtRandom(p);
  };

  switch (mode) {
    case "infection": {
      const first = humans[Math.floor(Math.random() * humans.length)];
      if (first) {
        infect(g, first, null, true);
        g.round.firstZombie = first.name;
      }
      break;
    }
    case "multi": {
      const count = Math.max(2, Math.floor(humans.length * 0.15));
      for (const p of shuffle(humans).slice(0, count)) infect(g, p, null, true);
      break;
    }
    case "swarm": {
      const target = Math.min(all.length - 1, Math.max(1, Math.floor(all.length * 0.5)));
      for (const p of shuffle(all).slice(0, target)) {
        infect(g, p, null, false);
        p.maxHp = Math.max(p.maxHp, 1200);
        p.hp = p.maxHp;
        g.spawnAtRandom(p);
      }
      break;
    }
    case "nemesis": {
      const h = humans[Math.floor(Math.random() * humans.length)];
      if (h) {
        makeBoss(h, "nemesis");
        g.round.firstZombie = h.name;
      }
      break;
    }
    case "survivor": {
      const [surv, ...rest] = shuffle(humans);
      if (surv) {
        makeBoss(surv, "survivor");
        g.round.firstZombie = surv.name;
        for (const p of rest) {
          infect(g, p, null, false);
          g.spawnAtRandom(p);
        }
      }
      break;
    }
    case "plague": {
      const [z, h, ...rest] = shuffle(humans);
      if (z) makeBoss(z, "nemesis");
      if (h) makeBoss(h, "survivor");
      for (const p of rest.slice(0, Math.floor(rest.length / 2))) {
        infect(g, p, null, false);
        g.spawnAtRandom(p);
      }
      break;
    }
    case "armageddon": {
      const half = Math.floor(all.length / 2);
      const list = shuffle(all);
      list.slice(0, half).forEach((p) => makeBoss(p, "nemesis"));
      list.slice(half).forEach((p) => makeBoss(p, "survivor"));
      break;
    }
  }

  g.countTeams();
  g.broadcast({ t: "roundStart", d: { ...g.round } });
  g.broadcastChat(roundIntro(g, mode));
}

function roundIntro(g: Game, mode: GameMode): string {
  const ev: Parameters<typeof narrate>[0] =
    mode === "infection" ? "round_start" : mode;
  return `[${MODE_INDEX[mode].label}] ${narrate(ev, g.round.firstZombie)}`;
}

export function endRound(g: Game, winner: Team | "draw", reason: string) {
  g.round.phase = "over";
  g.round.timeLeft = 5;
  g.broadcast({ t: "roundEnd", d: { winner, reason } });
  for (const p of g.players) {
    const bonus = winner === "draw" ? 0 : p.team === winner ? BALANCE.apWinner : BALANCE.apLoser;
    g.ap.set(p.id, g.getAp(p.id) + bonus);
    g.sendTo(p.id, { t: "shop", d: { ap: g.getAp(p.id), owned: [...g.owned.get(p.id)!] } });
  }
  const ev = winner === "zombie" ? "zombie_win" : winner === "human" ? "human_win" : "draw";
  g.broadcastChat(`🦴 ${narrate(ev)}`);
  g.broadcastChat(`Resultado: ${reason}`, true);
  g.scheduleNextRound(5000);
}

export function checkRoundEnd(g: Game) {
  if (g.round.phase !== "hunt" && g.round.phase !== "last_human") return;
  const humans = g.players.filter((p) => p.alive && p.team === "human");
  const zombies = g.players.filter((p) => p.alive && p.team === "zombie");

  if (humans.length === 1 && zombies.length > 0 && g.round.phase !== "last_human") {
    g.round.phase = "last_human";
    const h = humans[0];
    h.maxHp = Math.max(h.maxHp, h.hp + BALANCE.lastHumanBonusHp);
    g.broadcastChat(`❤️ ${narrate("last_human", h.name)}`);
    g.broadcast({ t: "roundStart", d: { ...g.round } });
  }
  if (zombies.length === 1 && humans.length > 0 && g.round.phase === "hunt" && !g.announcedLastZombie) {
    g.announcedLastZombie = true;
    g.broadcastChat(`☠️ ${narrate("last_zombie", zombies[0].name)}`);
  }

  switch (g.round.mode) {
    case "swarm":
    case "armageddon":
      if (humans.length === 0) endRound(g, "zombie", "Humanos eliminados");
      else if (zombies.length === 0) endRound(g, "human", "Zumbis eliminados");
      break;
    case "nemesis": {
      const nem = g.players.find((p) => p.isBoss && p.team === "zombie" && p.alive);
      if (!nem) endRound(g, "human", "NEMESIS foi derrotado");
      else if (humans.length === 0) endRound(g, "zombie", "Todos os humanos caíram");
      break;
    }
    case "survivor": {
      const surv = g.players.find((p) => p.isBoss && p.team === "human" && p.alive);
      if (!surv) endRound(g, "zombie", "SURVIVOR caiu");
      else if (zombies.length === 0) endRound(g, "human", "A horda foi exterminada");
      break;
    }
    default:
      if (humans.length === 0) endRound(g, "zombie", "Todos infectados");
      else if (zombies.length === 0) endRound(g, "human", "Horda exterminada");
  }
}
