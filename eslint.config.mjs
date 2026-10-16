import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Supabase rows are handled untyped (`any`) throughout the app by
      // design -- typing them properly means generating database types,
      // which is its own project. Until then this rule only adds noise that
      // hides real problems.
      "@typescript-eslint/no-explicit-any": "off",
      // Every <img> here shows a signed Supabase Storage URL, a QR code or
      // a local upload preview, none of which next/image can optimize.
      "@next/next/no-img-element": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
