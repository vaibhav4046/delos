import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // React Compiler hints are gate-blocking errors. The codebase was swept for
    // each: behavior-changing fixes where safe, and tightly-scoped eslint-disable
    // directives (with rationale) for intentional patterns — SSR-safe mount-effect
    // hydration, render-time clock reads, and the imperative Del Doom game loop.
    rules: {
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/purity": "error",
      "react-hooks/refs": "error",
      "react-hooks/immutability": "error",
    },
  },
]);

export default eslintConfig;
