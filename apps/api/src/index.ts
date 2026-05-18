import { start } from "./server.js";

start().catch((err) => {
  console.error("Failed to start api", err);
  process.exit(1);
});
