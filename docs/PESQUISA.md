# A PRAGA - pesquisa tecnica (online, fisica, assets, movimento)

> Nota: relatorio gerado em pesquisa web. O repo ja tinha predicao + interpolacao de snapshots (`src/client/predict.ts`, `interp.ts`). Nesta branch foram implementados: salas/lobby/ping, movimento Source (air-strafe, anti-bhop, coyote), granadas com quique (`src/shared/bounce.ts`), cartuchos/destrocos/cadaveres com fisica e personagens GLB. Binario/delta/lag compensation e Rapier ficam como proximos passos.

Data: 2026-10-20. Teste de rede: sandbox so com proxy HTTPS. github.com, codeload.github.com, api.github.com e poly.pizza retornam 403.

## 0. Achados sobre o repo atual (afetam todas as recomendacoes)
- src/server/lobby.ts ja tem salas (Room, MAX_ROOMS=24, MAX_HUMANS=10, codigo, TTL de sala vazia). O item (1) "salas/lobby" ja existe; falta so UX/matchmaking e hospedagem publica.
- src/shared/movement.ts ja e modelo Source (accelerate/friction/air cap/bhop com teto). Falta rampas (so AABB), slide, step suave. STEP_HEIGHT=0.55 ja existe em map.ts.
- Dockerfile multi-stage (node:24-alpine, PORT=8080) ja pronto para Fly/Render/Railway.
- Armas Quaternius ja em public/models/weapons/. Personagens sao procedurais (caixas).

## A) Netcode / online
| Opcao | Licenca | Transporte | Encaixa no `ws` atual? | Veredito |
|---|---|---|---|---|
| Manter `ws` + protocolo proprio | MIT (ws 8.22) | TCP/WS | sim, zero reescrita | RECOMENDADO |
| Colyseus 0.18 (@colyseus/core, ws-transport) | MIT | WS | reescreve rooms/state em Schema (delta ja incluso), mas a sala Room+lobby do repo ja faz o papel | opcional; so vale se quiser matchmaking pronto |
| Geckos.io 3.1 | BSD-3 | WebRTC DataChannel (UDP-like) | exige @roamhq/wrtc nativo no Node, TURN, portas UDP; Fly suporta UDP, Render/Railway nao | so se jitter/head-of-line do TCP incomodar |
| WebTransport | padrao W3C | QUIC/HTTP3 | sem suporte Safari estavel/ecossistema Node imaturo | ignorar por ora |
| PartyKit / Durable Objects | MIT (0.0.115) | WS | 1 DO por sala e simples, mas sem loop 20Hz pesado/ CPU limits; reescrita total | ignorar (jogo autoritativo com fisica/bots) |
| Nakama 2.8 | Apache-2.0 | WS/gRPC | backend Go separado; excesso | ignorar |
| Socket.IO 4.8 | MIT | WS+fallback | overhead sem ganho | ignorar |
| Hathora / Fly / Render / Railway | - | hospedagem | ver abaixo | Fly.io |

Tecnicas (ordem de custo/beneficio para o repo):
1. Snapshot interpolation no cliente (render ~100 ms atras, buffer de 2 snapshots a 20Hz) - barato, maior ganho visual para outros jogadores.
2. Client prediction + reconciliacao: ja existe (movimento compartilhado). Manter input numerado (seq) e reenviar ate o ack.
3. Lag compensation de tiro: servidor guarda historico de posicoes (~300-500 ms, ring buffer por entidade) e rebobina hitboxes ao resolver o raycast com o timestamp do atirador. So hitscan precisa.
4. Binario: trocar JSON por @msgpack/msgpack 3.1 (ISC) ou DataView proprio para snapshots; quantizar posicao (int16 em cm), yaw/pitch (uint16). Tipicamente corta 70-85% dos bytes.
5. Delta compression: enviar so entidades mudadas + full snapshot a cada N ticks / ao entrar; ids numericos curtos.
6. perMessageDeflate no `ws` fica desligado (CPU alta, latencia); usar binario quantizado em vez disso. Desligar Nagle (`socket.setNoDelay(true)`).
7. Subir tick de 20Hz para 30Hz so se necessario; interpolar mantem 20Hz aceitavel.

Hospedagem publica (Dockerfile ja pronto):
- Fly.io (RECOMENDADO): sem free tier; shared-cpu-1x 256MB ~US$1,94-2,19/mes (pricing oficial). WebSocket nativo, regiao gru (Sao Paulo) para BR, auto-TLS (wss://), suporta UDP se um dia usar Geckos. `fly launch` detecta o Dockerfile; internal_port=8080, `auto_stop_machines=false`, `min_machines_running=1` (jogo com estado em memoria = 1 maquina so, sem escalar horizontal).
- Render: free dorme apos 15 min (cold start ~1 min) = ruim para jogo; plano pago a partir de US$7/mes funciona com WS.
- Railway: uso por consumo (~US$5/mes Hobby), WS ok, regioes limitadas (sem Brasil na maioria dos planos - confirmar).
- Hathora: foco em servidores dedicados por sala (containers efemeros), util so para escalar muito; excessivo agora.
- Cliente estatico pode ir para Cloudflare Pages/Netlify e conectar por `wss://app.fly.dev`; ou servir tudo do mesmo Node (como hoje).
**Recomendacao A:** manter `ws`, adicionar snapshot interpolation + binario quantizado + delta + lag compensation, publicar no Fly.io (gru). Nao migrar para Colyseus/Geckos agora.

## B) Fisica
| Lib | Versao/licenca | Roda no Node? | Determinismo | Custo | Uso sugerido |
|---|---|---|---|---|---|
| Rapier (@dimforge/rapier3d-compat) | 0.21.0, Apache-2.0 | sim (wasm embutido em base64 no -compat; existe tambem @dimforge/rapier3d) | declarado deterministico (mesma ordem/versao/plataforma) | medio, rapido (SIMD builds separadas) | RECOMENDADO cliente (ragdoll, debris, granadas visuais) e opcional servidor para props/granadas |
| Jolt (jolt-physics) | 1.1.0, MIT | sim (wasm) | bom, projetado para jogos (Horizon) | melhor em pilhas grandes; API C++-like (gerenciar memoria manual: Jolt.destroy) | alternativa forte se precisar de muitos corpos/ragdoll no servidor |
| cannon-es | 0.20.0, MIT | sim (JS puro) | JS puro e deterministico em teoria, mas lento e sem manutencao ativa | lento | evitar |
| Ammo.js / Havok | Bullet-wasm / Havok proprietario (babylon) | sim | - | pesados / licenca restritiva | evitar |
| three-mesh-bvh | 0.9.16, MIT | sim | n/a (so queries) | muito barato | raycast/colisao contra malha GLB (balas, rampas, mapa nao-AABB) |
| Navmesh: navcat 0.4.1 (MIT) ou recast-navigation 0.43.1 (@recast-navigation/core, MIT, wasm) | - | sim | n/a | gera navmesh de triangulos | substituir grade/nav.ts dos bots se mapa virar malha |

Regras praticas:
- Servidor autoritativo: NAO simular ragdoll nem debris. So o que afeta jogabilidade: granadas (esfera + bounce - ja existe src/shared/bounce.ts), props empurraveis (poucos, 10-30 corpos) -> Rapier no servidor e viavel (custo baixo a 20-60Hz fixo) ou continuar com AABB + bounce proprio. Enviar posicao/rotacao quantizada dos props no snapshot.
- Cliente: ragdoll no momento da morte (Rapier + juntas esfericas/cone, ~11 corpos por zumbi, limitar a ~8 ragdolls simultaneos e dormir apos 3 s), cartuchos, gibs, detritos de explosao - cosmetico, nao precisa sincronizar (semente + evento "morte com impulso X").
- Controle do jogador: manter o movimento proprio (shared/movement.ts) - NAO usar KinematicCharacterController do Rapier no jogador, perde-se a identica simulacao cliente/servidor. Para rampas, adicionar ao map.ts primitivos "ramp" (plano inclinado, normal.y>=0.7) ou usar three-mesh-bvh em malha.
- Determinismo: servidor e cliente nao precisam do mesmo resultado para fisica cosmetica; so para o movimento do jogador (ja compartilhado).
**Recomendacao B:** cliente = Rapier (compat) carregado sob demanda (lazy import, ~1-2 MB wasm); servidor = sem engine nova no inicio, evoluir para Rapier so para props/granadas; three-mesh-bvh se o mapa virar GLB; navcat/recast so se criar navmesh.

## C) Assets gratis (licenca verificada; "OK" = baixei com curl GET e conferi tamanho/magic bytes)
| Asset | URL direta | Licenca | Formato | Download direto? |
|---|---|---|---|---|
| KayKit Adventurers 1.0 (Knight, Barbarian, Mage, Rogue, Rogue_Hooded; 76 animacoes no GLB: Idle, Running_A/B, Walking_*, Jump_*, Death_A/B, Hit_A/B, Unarmed punch/kick, 1H/2H ranged shoot/reload, Throw...) | https://cdn.jsdelivr.net/gh/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0@main/addons/kaykit_character_pack_adventures/Characters/gltf/Knight.glb (idem Barbarian.glb, Mage.glb, Rogue.glb, Rogue_Hooded.glb; ~3,6 MB cada) + textura em .../Assets/gltf/knight_texture.png | CC0 (README do repo) | GLB rigged+animado | OK (Knight.glb 3.659.532 B, Rogue_Hooded.glb 3.597.652 B, magic glTF) |
| KayKit repos extras (props de cenario CC0): Halloween-Bits-1.0, Dungeon-Remastered-1.0, Medieval-Hexagon-Pack-1.0, Restaurant-Bits-1.0, Space-Base-Bits-1.0 | https://cdn.jsdelivr.net/gh/KayKit-Game-Assets/<repo>@main/README.md (listar arquivos: https://data.jsdelivr.com/v1/packages/gh/KayKit-Game-Assets/<repo>@main?structure=flat) | CC0 | GLTF/OBJ/FBX | OK (listagem e README retornam 200) |
| KayKit Skeletons (zumbi/esqueleto) | nao achei repo no jsDelivr (varios nomes 404) | CC0 (pagina itch) | GLB | NAO direto; baixar manual em https://kaylousberg.itch.io/kaykit-skeletons |
| Quaternius (Animated Zombie, Ultimate Modular Men, Zombie Apocalypse Kit, Ultimate Guns...) | paginas https://quaternius.com/packs/animatedzombie.html , /packs/ultimatemodularcharacters.html , /packs/zombieapocalypsekit.html | Pagina do pack diz CC0; MAS https://quaternius.com/license.html agora publica "Quaternius Asset License (QAL) v1.0" (atualizada 28/08/2026): uso comercial livre, sem credito, proibido redistribuir os assets como pack avulso. Tratar como QAL; ok para embutir no jogo, nao republicar os arquivos num repo publico como pack | FBX/OBJ/glTF/Blend | NAO: botao leva a pasta Google Drive (https://drive.google.com/drive/folders/1AfOPRgr5Gl8gll9KfGDEUSYq_Ag7yPJG para Animated Zombie; retorna HTML, nao arquivo) ou itch. Download manual |
| Kenney Blocky Characters | https://kenney.nl/media/pages/assets/blocky-characters/8369c0cf30-1749547469/kenney_blocky-characters_20.zip | CC0 | zip (GLB/FBX/OBJ, skins PNG) | OK (2.148.510 B, zip). Bom para skins: texturas trocaveis sobre o mesmo rig |
| Kenney Impact Sounds | https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip | CC0 | zip OGG | OK (5,06 MB). Outros packs Kenney: pegar o link .zip na pagina https://kenney.nl/assets/<slug> (grep `kenney.nl/media/...zip`); a pasta /media/pages/ sem arquivo da 403 |
| Poly Haven HDRI (skybox) | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloppenheim_02_puresky_1k.hdr | CC0 | .hdr (RGBE) | OK (1.393.622 B) |
| Poly Haven textura PBR | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_02/concrete_floor_02_diff_1k.jpg (+ _nor_gl_1k.jpg, _rough_1k.jpg; tambem gltf 1k) | CC0 | JPG/EXR/glTF | OK (diff 776.097 B; nor 192.757 B; rough 318.550 B) |
| Poly Haven modelo (prop) | https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/barrel_03/barrel_03_1k.gltf (referencia .bin e texturas relativas: baixar via https://api.polyhaven.com/files/<id>, que respondeu 200) | CC0 | glTF multi-arquivo | OK (gltf 2.638 B; API de listagem OK) |
| ambientCG textura | https://ambientcg.com/get?file=Concrete034_1K-JPG.zip (padrao `?file=<Id>_<1K|2K>-JPG.zip`) | CC0 | zip JPG (Color/NormalGL/Roughness/AO/Displacement) | OK (3.657.575 B). A API https://ambientcg.com/api/v2/full_json nao conectou |
| three.js r170 Soldier.glb / Xbot.glb (humano animado de teste, vindo do Mixamo) | https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/gltf/Soldier.glb ; https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/Soldier.glb ; .../Xbot.glb | MIT no repo; personagem Mixamo (termos Adobe, uso livre em jogo mas nao redistribuir como asset) | GLB | OK (Soldier 2.160.468 B; Xbot 2.930.032 B). So para teste de rig |
| Mixamo | https://www.mixamo.com/ | Adobe: gratis para uso em jogos, exige login Adobe, nao e CC0 | FBX | NAO (login) |
| Freesound | previews diretos: https://freesound.org/data/previews/<pasta>/<id>_<user>-lq.mp3 (ex. 341/341695_5858296-lq.mp3) | licenca POR SOM (CC0, CC-BY, CC-BY-NC): filtrar CC0 na busca e conferir cada um | MP3/OGG preview; original exige login/API | preview OK (200, audio/mpeg); original NAO |
| OpenGameArt | https://opengameart.org/sites/default/files/<arquivo> funciona (testado zip de terceiros) | por item (CC0/CC-BY/GPL) - conferir na pagina | variado | OK acesso, licenca a verificar item a item |
| Poly Pizza / Sketchfab | poly.pizza 403; sketchfab responde 202 | por modelo (CC0/CC-BY) | GLB | NAO via sandbox (Sketchfab exige API token) |
| Rapier/libs por CDN | https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/rapier.es.js ; https://unpkg.com/@dimforge/rapier3d-compat@0.14.0/rapier.es.js ; registry.npmjs.org (npm install funciona) | Apache-2.0 | JS | OK (2.059.628 B). Preferir `npm i` (latest 0.21.0) |

Skins novas (item 2), caminho de menor risco: (a) manter personagens procedurais e adicionar paletas/texturas por canvas (zero download); (b) trocar para GLB KayKit (rig + animacoes prontas, textura de atlas 1024 que pode ser repintada para virar skins); (c) Kenney Blocky Characters tem varias skins PNG no mesmo rig. Para zumbis no estilo KayKit, tingir o material (verde/cinza) + decals em canvas.
Baixar e commitar em public/models/ (nao depender de CDN em producao): ~3,6 MB/personagem; com gltf-transform (meshopt/draco + resize de textura) cai para < 1 MB.
Avisos de licenca: Quaternius = QAL (nao redistribuir packs); Mixamo/Soldier nao e CC0; Freesound varia por arquivo; manter um arquivo CREDITS/ASSETS.md mesmo quando atribuicao nao e exigida.

## D) Movimento estilo Source/GoldSrc (CS 1.6) em metros
Escala: oficial Valve 16 u = 1 pe -> 1 u = 0,01905 m. Jogo de browser costuma usar "escala de jogador" 72 u (hull em pe) = 1,8 m -> 1 u = 0,025 m. Colunas abaixo mostram ambas.
| Cvar / constante | Valor CS 1.6 / Source | m (0,01905) | m (0,025) |
|---|---|---|---|
| sv_gravity | 800 u/s^2 | 15,24 m/s^2 | 20,0 |
| sv_maxspeed / run (rifle ~250 u/s, faca 250; CSS 260; cap 320) | 250-320 u/s | 4,76-6,10 | 6,25-8,0 |
| sv_accelerate (chao) | 10 (CS:S 10; CS:GO 5,5) | multiplicador adimensional | idem |
| sv_airaccelerate | 10 em CS 1.6 / CS:S (servidores surf 100+; CS:GO 12) | idem | idem |
| sv_friction | 4 (adimensional, multiplicador de `control`) | idem | idem |
| sv_stopspeed | 75 u/s (piso do `control` da friccao) | 1,43 m/s | 1,88 |
| air wishspeed cap | 30 u/s | 0,57 m/s | 0,75 |
| velocidade de pulo | ~268,3 u/s (= sqrt(2*800*45), altura ~45 u) | 5,11 m/s (altura 0,86 m) | 6,71 m/s (1,125 m) |
| sv_stepsize | 18 u | 0,343 m | 0,45 m |
| hull em pe / agachado | 32x32x72 / 32x32x36 (CS 1.6; Source CS:S/GO agachado 54) | 0,61x1,37 / 0,69 m | 0,8x1,8 / 0,9 m |
| altura dos olhos em pe / agachado | 64 u / 28 u (CS 1.6) | 1,22 / 0,53 | 1,6 / 0,7 |
| inclinacao andavel | normal.y >= 0,7 (~45,6 graus); acima disso desliza (surf) | - | - |
| sv_maxvelocity | 2000 u/s | 38 | 50 |

Formulas (Source `PM_*`, por tick dt):
- Friccao (so no chao): speed=|v_xz|; se speed<0.1 zera; control = max(speed, stopspeed); drop = control*sv_friction*dt; v *= max(speed-drop,0)/speed. (Na GoldSrc a friccao nao e aplicada no frame do pulo = base do bhop.)
- Accelerate (chao): addspeed = wishspeed - dot(v, wishdir); se <=0 sai; accelspeed = min(sv_accelerate*dt*wishspeed, addspeed); v += accelspeed*wishdir.
- AirAccelerate: igual, mas wishspd = min(wishspeed, 30 u/s) ANTES de calcular addspeed = wishspd - dot(v,wishdir); accelspeed = min(sv_airaccelerate*wishspeed*dt, addspeed). Como o projeto do wish e so no eixo da mira, girar o mouse enquanto aperta A/D (strafe) permite ganhar velocidade acima da corrida (air-strafe). O ganho maximo por tick e ~wishspd(30 u/s) quando o angulo entre v e wishdir ~90 graus.
- Bhop: pulo apenas na borda de subida (ou auto-bhop se segurar), sem friccao no tick do pouso; CS 1.6 aplica teto de pre-strafe ~1,2x maxspeed no pulo (parte de movement.ts: BHOP_CAP=1.2, ja implementado).
- Step: ao colidir horizontalmente, tentar trace para cima ate stepsize, avancar, descer ate o chao; aceitar se o novo piso tem normal.y>=0.7. Hoje map.ts resolve por box-top <= STEP_HEIGHT=0.55; para rampas suaves adicionar projecao da velocidade no plano (ClipVelocity, overbounce 1.0): v -= n*dot(v,n).
- Slope/Surf: se normal.y < 0.7, nao e chao, velocidade e clipada no plano e a gravidade continua -> surf. Rampas andaveis: manter onGround e projetar wishdir no plano para nao "quicar" ao descer (snap ao chao quando |vy|<~3 m/s e piso a < stepsize abaixo).
- Slide (estilo Apex/CoD, nao existe no Source): iniciar agachado com speed>=run*0.9; impulso inicial +15-25% limitado a 1,3x run; friccao reduzida (~0,2 do normal) por 0,7-1,0 s; sem controle de aceleracao no chao; cancelar ao baixar de ~runSpeed*0.5. Gerar hitbox agachada.
- Valores atuais do repo (GROUND_ACCEL 10, AIR_ACCEL 12, FRICTION 6, STOP_SPEED 1.9, AIR_WISH_CAP 1.1) ja estao na faixa Source adaptada (friccao 6 e ~50% maior que CS 1.6 = mais "snappy"). Para mais fidelidade ao CS 1.6: FRICTION 4, AIR_WISH_CAP 0.75 (escala 0,025), AIR_ACCEL 10; para strafe mais permissivo, subir AIR_WISH_CAP para 1.1-1.5 (ja esta).
Fonte: valores de memoria tecnica do `gamemovement.cpp` (Source SDK 2013) / GoldSrc `pm_shared.c`; NAO reconfirmados online nesta sessao. Conferir antes de tratar como exatos.

## Recomendacao final por area
- A (online): manter `ws`; adicionar interpolacao de snapshot, binario quantizado + delta, lag compensation de hitscan, TCP_NODELAY; deploy no Fly.io regiao gru, 1 maquina sempre ligada (~US$2-5/mes). Lobby/salas ja existem.
- B (fisica): Rapier-compat so no cliente para ragdoll/debris (lazy load); servidor continua com AABB + bounce proprio, Rapier no servidor so se virarem muitos props; three-mesh-bvh se o mapa vier de GLB; navcat/recast so se trocar o grid de nav.
- C (assets): usar KayKit Adventurers via jsDelivr (CC0, GLB rigged com 76 anims, unico pack de personagem com download direto confirmado) + Kenney Blocky Characters zip (CC0, skins) + Poly Haven/ambientCG (CC0) para texturas/HDRI + Kenney audio. Quaternius (zombie/men) exige download manual (Drive) e licenca QAL.
- D (movimento): aproveitar movement.ts; adicionar (1) rampa como primitivo com ClipVelocity + snap ao chao, (2) step por trace (em vez de box-top), (3) slide como estado do agachar em velocidade; manter bhop com teto.
