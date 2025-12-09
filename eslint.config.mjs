import js from "@eslint/js";

export default [
  {
    ignores: [
      "node_modules",
      "public",
      ".next",
      "dist",
      "functions/**",
      "src/lib/javascript/**",
      "**/*.ts",
      "**/*.tsx",
    ],
  },
  {
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
];
