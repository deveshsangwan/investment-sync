import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: ["node_modules/**", ".next/**", "dist/**", ".expo/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
    },
  },
];
