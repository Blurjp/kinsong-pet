// Minimal setup: Expo's recommended rules, no formatting rules.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  { ignores: ["ios/**", "android/**", ".expo/**", "dist/**"] },
]);
