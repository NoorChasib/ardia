import { fileURLToPath } from "node:url";
import { resolveConfig } from "vite";

await resolveConfig({ root: fileURLToPath(new URL("..", import.meta.url)), logLevel: "error" }, "build");
