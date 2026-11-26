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
    // A gitignored worktree is not invisible to a flat config, so eslint
    // walks into a sibling feature's .next output and dies on minified
    // chunks. The ignores above are why this is needed and not sufficient.
    ".worktrees/**",
    "capture*.js",
    "capture_ai*.js",
    "probe_owner.js",
    "dbg-upload.mjs",
  ]),
]);

export default eslintConfig;
