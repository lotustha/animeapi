import { createApp } from "./app.js";
import { PORT, validateConfig } from "./core/config.js";
import { Logger } from "./core/logger.js";
import { isDeno } from "./core/runtime.js";

validateConfig();

const app = await createApp();

if (isDeno) {
  // @ts-expect-error - Deno global
  Deno.serve({ port: PORT }, app.fetch);
} else {
  app.listen(PORT);
  Logger.info(`Started at http://localhost:${PORT}`);
}
