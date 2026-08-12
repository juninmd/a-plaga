import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
  resolve: {
    // Resolve imports com extensão .js para arquivos .ts (NodeNext no server/shared)
    extensions: [".ts", ".js"],
  },
});
