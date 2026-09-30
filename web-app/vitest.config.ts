import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for pure modules (money, date attribution, branding transforms).
// No network, no Supabase: anything touching I/O is out of scope here.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".vercel/**"],
  },
});
