// ESLint 9 flat config (Next.js 16 removed `next lint` and the legacy
// .eslintrc format). Same rules as before: next/core-web-vitals.
import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  {
    // New in eslint-plugin-react-hooks 7 (bundled with Next 16). Kept as
    // warnings so the lint gate matches Next 15's; the 5 existing call sites
    // are a separate, behaviour-neutral refactor.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/use-memo": "warn",
    },
  },
  {
    ignores: [".next/**", ".vercel/**", ".wrangler/**", ".open-next/**", "node_modules/**", "next-env.d.ts"],
  },
];

export default config;
