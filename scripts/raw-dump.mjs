import WebSocket from "ws";
const ws = new WebSocket("ws://localhost:8080/ws");
let n = 0;
ws.on("open", () => {
  ws.send(JSON.stringify({ t: "join", d: { name: "X" } }));
});
ws.on("message", (raw) => {
  const s = raw.toString();
  n++;
  if (n >= 3 && n <= 5) {
    console.log(`MSG#${n} len=${s.length}`);
    console.log("  HEAD:", JSON.stringify(s.slice(0, 100)));
    try {
      const j = JSON.parse(s);
      console.log("  parsed t:", typeof j, j?.t);
    } catch (e) {
      console.log("  PARSE ERROR:", e.message);
      console.log("  BYTES:", [...Buffer.from(s).subarray(0, 60)]);
    }
  }
});
setTimeout(() => process.exit(0), 4000);
