import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: true,
    worker: {
      format: "es"
    }
  },
  test: {
    environment: "node",
    globals: true
  }
});
