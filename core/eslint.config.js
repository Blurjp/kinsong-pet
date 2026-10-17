import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Minimal setup: recommended rules only, no formatting rules.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
);
