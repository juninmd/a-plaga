// ===== "A Praga" — a infecção tem voz =====
// 1ª pessoa, onisciente, debochada, humor brasileiro. Frases curtas (máx 2 linhas).

export type NarratorEvent =
  | "round_start"
  | "first_zombie"
  | "last_human"
  | "last_zombie"
  | "nemesis"
  | "survivor"
  | "human_win"
  | "zombie_win"
  | "draw"
  | "multi"
  | "plague"
  | "armageddon"
  | "swarm";

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}

const PHRASES: Record<NarratorEvent, string[]> = {
  round_start: [
    "O ar mudou. Vocês sentem?",
    "Mais uma dança. Eu escolho os passos.",
    "Respirem fundo. Pode ser a última vez.",
    "A carne fresca está na mesa. Literalmente.",
  ],
  first_zombie: [
    "Primeira mordida... que delícia de começo.",
    "Olha só quem virou o jogo. Ele. Sim, ele.",
    "A infecção escolheu seu porta-voz.",
    "Corre, {name}. O resto já te viu de lado.",
  ],
  last_human: [
    "Só sobrou você, {name}. Sente o coração?",
    "Último de pé. A paranoia é o meu tempero favorito.",
    "{name}... eles estão só esperando a sua fome.",
    "Um contra todos. Exatamente como eu planejei.",
  ],
  last_zombie: [
    "Rodeado de humanos? Que ironia deliciosa.",
    "A horda murchou, {name}. Agora é você.",
  ],
  nemesis: [
    "Ele não é um zumbi. Ele é a resposta.",
    "O predador acordou. E está de mau humor.",
    "NEMESIS. Repita esse nome enquanto ainda pode.",
  ],
  survivor: [
    "Um sobrevivente de verdade. Que emocionante.",
    "A última trincheira da humanidade... com munição infinita.",
    "SURVIVOR no ar. Não estraguem tudo, zumbis.",
  ],
  human_win: [
    "Impresso em você: derrota. Guarde de lembrança.",
    "A carne escapa hoje... mas o amanhã é meu.",
    "Vocês ganharam. Dessa vez.",
  ],
  zombie_win: [
    "Mais uma refeição completa. Obrigada pelo jantar.",
    "A Praga não conhece derrota. Apenas aperitivos.",
    "Vejo vocês do outro lado. Todos vocês.",
  ],
  draw: [
    "Empate? Que tédio. Amanhã tem mais.",
    "Ninguém venceu... e eu gostei assim.",
  ],
  multi: [
    "Não um. VÁRIOS. Espero que gostem de multidões.",
    "A horda se multiplica. Matemática simples.",
  ],
  plague: [
    "Todo mundo na arena. Nemesis, Survivor, zumbis, humanos... que confusão linda.",
    "O apocalipse em miniatura. Aperte o play.",
  ],
  armageddon: [
    "O fim dos tempos, versão econômica.",
    "Metade vai morrer. A outra metade também. É o fim.",
  ],
  swarm: [
    "Sem infecção hoje. Só massacre direto.",
    "Zumbis contra humanos. Sem cerimônia.",
  ],
};

export function narrate(ev: NarratorEvent, name?: string): string {
  const pool = PHRASES[ev];
  let phrase = pick(pool);
  if (name) phrase = phrase.replace(/\{name\}/g, name);
  return phrase;
}

// Mensagens de sistema (tom neutro, informação primeiro)
export const SYS = {
  spawnProtection: (s: number) => `Proteção de spawn: ${s}s`,
  infection: (zombie: string, human: string) => `${human} foi infectado por ${zombie}`,
  kill: (killer: string, victim: string) => `${killer} eliminou ${victim}`,
  bought: (item: string, ap: number) => `Comprou ${item} por ${ap} AP`,
  notEnoughAp: () => "AP insuficiente.",
  ammoPicked: (v: number) => `+${v} AP`,
  roundEnd: (winner: string) => `Fim de round — ${winner}`,
  classUnlocked: (lvl: number) => `Classe liberada no nível ${lvl}`,
};
