import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for pure modules (money, date attribution, branding transforms)
// plus server-rendered markup checks for shared UI (react-dom/server).
// No network, no Supabase: anything touching I/O is out of scope here.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  // tsconfig says jsx: "preserve" (Next compiles JSX); tests render with React 18.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.tsx", "app/**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**", ".vercel/**"],
  },
});
