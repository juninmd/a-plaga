# A PRAGA — Zombie Plague 3D

Jogo 3D multiplayer no navegador inspirado no **Zombie Plague 5.0** do
[zplague-addons](https://github.com/juninmd/zplague-addons) (CS 1.6 / AMX Mod X).

> "A infecção tem voz." — identidade herdada do GAME_DESIGN.md dos addons.

## Como jogar

Abra o link, digite seu nome e entre. O servidor roda 20 ticks/s com
autoridade total; bots (com pathfinding A* no mapa) preenchem até 8 jogadores.

- **WASD** mover · **Mouse** mirar · **Clique** atirar · **Botão direito** zoom (AWP)
- **Ctrl/C** agachar · **Espaço** pular · **R** recarregar · **E** habilidade
- **1/2/3** ou roda do mouse trocar arma · **B** menu de compra · **Tab** placar · **Enter** chat
- Celular: analógico esquerdo move, arrastar na direita mira, botões de tiro/pulo/agachar/recarga/habilidade/troca

### Jogar no celular (rede local)

```powershell
npm run play      # build + servidor; imprime http://<IP-do-PC>:8080
```

Abra o endereço impresso no navegador do celular (mesma rede Wi‑Fi, tela em
paisagem). O `node.exe` precisa estar liberado no firewall do Windows para
conexões de entrada.

## Arsenal (CS 1.6)

Armas são grátis no menu **B** (compra só no spawn, como no CS): AK-47, M4A1,
AWP (com zoom), MP5, XM1014, M3, M249 · Deagle, USP, Glock · faca. Precisão cai
andando/pulando e melhora agachado; recuo acumula por rajada.

## Mecânicas herdadas dos addons

- **Rounds com modos sorteados** (sem repetir consecutivo, como
  `zp_prevent_consecutive_modes`): Infection, Multi, Swarm, Nemesis, Survivor,
  Plague, Armageddon.
- **Infecção**: 1º zumbi com Fúria (+30% speed, +25% dano por 10s), humano morto
  vira zumbi no respawn, último humano recebe bônus de herói.
- **7 classes zumbis**: Clássico, Runner (frenesi), Tank (salto+choque), Boomer
  (explode ao morrer), Smoker (língua puxa), Spitter (ácido em área), Witch
  (garra 200).
- **5 classes humanas**: Assault, Médico (cura área), Heavy (250HP, rage),
  Fantasma (invisível), Doom Slayer (berserk, nível 8).
- **Itens extras (menu B)**: adrenalina, medkit, granada de fogo, granada de
  gelo, pipe bomb, colete, instinto/regeneração/fúria/investida zumbi.
- **Economia AP**: começa com 1000; kill +3AP (zumbi)/+2AP (humano), dano 1/500,
  infecção +1, drop físico de ammo pack ao matar zumbi, vitória +3.
- **Knockback por arma** com multiplicador por classe (Tank/Nemesis quase imunes).
- **"A Praga" narra**: mensagens em 1ª pessoa com humor brasileiro nos eventos.
- **Killstreaks**: 3 IMPAREÁVEL, 5 DOMINADOR, 7 DEUS DO ZP.

## Stack

- Cliente: TypeScript + Three.js + Vite
- Servidor: Node.js + `ws`, loop 20Hz autoritativo (movimento, colisão AABB,
  hitscan com LOS, projéteis, respawn com delay)
- Testes: Vitest (física, raycast, rounds, modos, infecção)

## Comandos

```powershell
npm run dev          # cliente (Vite, proxy /ws para :8080)
npm run build        # tsc server + vite build
npm start            # servidor em :8080 (serve dist/ + /ws)
npm test             # vitest
npm run typecheck    # typecheck client + server
```

## Deploy

Imagem `ghcr.io/juninmd/a-plaga:latest` via GitHub Actions; manifests no repo
`juninmd/app-charts` (pasta `a-plaga/`), ingress Traefik + wildcard TLS
(`*.antonio-code.duckdns.org`).

## Créditos

- Modelos 3D das armas: **Ultimate Guns Pack** de [Quaternius](https://quaternius.com/packs/ultimategun.html)
  (arquivos OBJ convertidos para GLB em `public/models/weapons/`). A página do pack aponta para
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) e o site distribui os packs sob a
  [Quaternius Asset License](https://quaternius.com/license.html): uso livre em projetos pessoais e
  comerciais, sem obrigação de crédito, sem redistribuir os modelos como produto avulso.
- Texturas, mapa, personagens, sons e demais assets são procedurais (gerados em código).
