import eslint from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import prettierPlugin from "eslint-plugin-prettier";
import tsEslint from "typescript-eslint";

export default tsEslint.config(eslint.configs.recommended, ...tsEslint.configs.recommended, {
  files: [ "**/*.ts", "**/*.json" ],
  ignores: [ "**/dist/**" ],
  languageOptions: {
    parser: tsParser
  },
  plugins: {
    prettier: prettierPlugin
  },
  rules: {
    curly: "error",
    "no-console": [
      "error",
      {
        allow: [ "warn", "error" ]
      }
    ],
    "no-debugger": "error",
    "prettier/prettier": [
      "error",
      {
        endOfLine: "auto"
      }
    ]
  }
});
