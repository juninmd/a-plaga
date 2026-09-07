// Sobe o servidor e imprime o endereço para abrir no celular (mesma rede Wi-Fi).
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 8080);

function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue;
      out.push({ name, address: a.address });
    }
  }
  return out;
}

if (!existsSync("dist/index.html") || !existsSync("dist-server/server/index.js")) {
  console.error("Build não encontrado. Rode `npm run build` antes.");
  process.exit(1);
}

console.log("A PRAGA — servidor local");
console.log(`  PC:      http://localhost:${PORT}`);
for (const a of lanAddresses()) console.log(`  Celular: http://${a.address}:${PORT}   (${a.name})`);
console.log("  Saúde:   /health");
console.log("O celular precisa estar na mesma rede. Se não abrir, libere a porta no firewall do Windows.\n");

const child = spawn(process.execPath, ["dist-server/server/index.js"], { stdio: "inherit", env: { ...process.env, PORT: String(PORT) } });
child.on("exit", (code) => process.exit(code ?? 0));
