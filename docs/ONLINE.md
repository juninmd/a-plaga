# Jogar online — arquitetura e hospedagem

## Arquitetura
- Servidor Node + `ws`, **autoritativo**, 20 Hz. Uma `Lobby` com várias `Room` (cada sala tem seu `Game`).
- Cliente: predição local (mesmo `src/shared/movement.ts` do servidor), reconciliação suave e
  interpolação de snapshots (~100 ms) para os demais jogadores.
- Protocolo `a-plaga-v3`: `join{name, room? | create?}` → `welcome{id, snapshot, room}`; `ping`/`pong` medem RTT.
- HTTP: `GET /rooms` (salas públicas) e `GET /health`.

## Proteções para servidor público
- `maxPayload` 4 KB, 90 msgs/s por conexão, chat com intervalo mínimo.
- Limite de conexões por IP (`MAX_CONN_PER_IP`, padrão 8) e total (`MAX_CONN_TOTAL`, padrão 300);
  atrás de proxy o IP vem de `X-Forwarded-For`.
- Heartbeat WebSocket a cada 15 s: conexão fantasma libera a vaga.
- Limite de 24 salas; sala vazia (exceto `ARENA`) é descartada após 60 s e não consome CPU.

## Hospedagem
O servidor serve o cliente (`dist/`) e o WebSocket na mesma porta (`PORT`, padrão 8080),
então qualquer host de container com suporte a WebSocket serve:
- **Fly.io**: `fly launch` usando o `Dockerfile`; porta interna 8080; 1 máquina `shared-cpu-1x` aguenta
  várias salas (a simulação é leve). Mantenha uma única instância (as salas ficam em memória).
- **Render / Railway**: Web Service com Docker, porta 8080.
- **Kubernetes** (atual): imagem `ghcr.io/juninmd/a-plaga` + ingress Traefik com TLS (`wss://` automático).
- **LAN**: `npm run play` imprime `http://<IP>:8080`.

Sticky/escala horizontal: como o estado das salas vive na memória do processo, para mais de uma
instância é preciso roteamento por sala (ex.: hash do código da sala no ingress) — não é necessário
para dezenas de jogadores.
