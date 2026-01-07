import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["./src/__mocks__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/__mocks__/**",
        "src/prompts.ts",
      ],
    },
  },
  resolve: {
    alias: {
      obsidian: resolve(__dirname, "./src/__mocks__/obsidian.ts"),
    },
  },
});
