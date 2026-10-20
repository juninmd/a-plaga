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

### Jogar online

Na tela inicial: **JOGAR AGORA** entra na sala pública mais cheia (abre outra se lotar),
a lista mostra as salas públicas, **+ SALA PRIVADA** gera um código de 5 letras e o
link `?sala=CODIGO` (clique no código no HUD para copiar). Cada sala é uma partida
independente (rounds, bots e física próprios, até 10 humanos). O HUD mostra o ping;
se a conexão cair o cliente reconecta sozinho na mesma sala. Hospedagem: ver `docs/ONLINE.md`.

### Jogar no celular (rede local)

```powershell
npm run play      # build + servidor; imprime http://<IP-do-PC>:8080
```

Abra o endereço impresso no navegador do celular (mesma rede Wi‑Fi, tela em
paisagem). O `node.exe` precisa estar liberado no firewall do Windows para
conexões de entrada.

## HUD, mapa e viewmodel (visual)

- **HUD v2**: layout em painéis chanfrados (fonte Rajdhani), radar circular rotativo (aliados sempre, inimigos por proximidade),
  bússola, placar de round com contagem de zumbis/humanos, vida/colete em barras segmentadas com "fantasma" de dano,
  anel de habilidade, munição com pips do carregador, aviso de recarga e slots com nome da arma.
- **Mapa**: texturas PBR (Poly Haven, CC0) com normal map em chão/paredes/madeira/concreto, céu HDRI com sol alinhado à luz,
  sombras, props 3D (barris, pneus, sacos de cimento, galões) ao pé das paredes. Desktop: AO (GTAO) + bloom leve e MSAA;
  `?fx=0` desliga o pós-processamento (mobile já vem desligado).
- **Viewmodel**: passe de render próprio (FOV 62, depth limpo — a arma não atravessa parede), inércia por mola amortecida ao
  mover o mouse, inclinação ao andar de lado, pose de corrida, impacto ao pousar, fumaça do cano e recarga em fases
  (mão esquerda troca o carregador no tempo real da arma).

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
- **Movimento estilo Source/CS**: fricção, aceleração no ar (air-strafe), teto anti-bhop 1,2×, coyote time,
  pulo só na borda de subida. Servidor e cliente usam o mesmo `stepMovement`.
- **Física**: granadas quicam/rolam em paredes e caixas (`src/shared/bounce.ts`), cuspe do Spitter explode no impacto;
  no cliente cartuchos de latão e destroços de explosão são corpos rígidos que colidem com o mapa, e cadáveres
  deslizam/tombam na direção do golpe.
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
- Personagem (humanos e zumbis): **Soldier.glb** (rig Mixamo "Vanguard") dos exemplos do
  [three.js](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf), em `public/models/characters/`.
  Assets Mixamo são gratuitos para uso em jogos, mas não podem ser redistribuídos avulsos — para um lançamento
  comercial troque por um personagem próprio/licenciado (basta manter os nomes dos ossos `mixamorig*`).
  As skins por classe são tintas/materiais aplicados sobre o mesmo modelo (`src/client/render/models/characters.ts`).
- Texturas PBR, HDRI do céu e props 3D do mapa: [Poly Haven](https://polyhaven.com) (CC0) — `public/textures`, `public/env`, `public/models/props`.
- Sons e demais assets são procedurais (gerados em código). Pesquisa de HUD/mapa/viewmodel: `docs/PESQUISA-VISUAL.md`.
- Pesquisa de frameworks/assets: `docs/PESQUISA.md`. Visualizadores (com `npm run dev`): `/dev-viewer.html` (skins) e `/dev-viewmodel.html?w=m4a1&c=assault` (primeira pessoa; `team=zombie&w=claws` para zumbi).
- Primeira pessoa: braços e luvas do mesmo soldado (malha só dos braços, IK de 2 ossos até as empunhaduras da arma); zumbis têm braços rasgados com garras. Zumbis em 3ª pessoa: cabeça apodrecida com olhos brilhantes, sangue/necrose por shader e acessórios por classe (espinhos do Tank, bolsa de bile do Boomer, chifres do Nemesis…).
