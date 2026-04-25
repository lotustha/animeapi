import { createApp } from "./app.js";
import { validateConfig } from "./core/config.js";

validateConfig();

const app = await createApp();

// Always listen — cPanel/LiteSpeed requires the process to bind a port.
// The previous serverless-style conditional (only listen outside production)
// caused 503 errors on cPanel because the app never bound to the port.
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
});

export default app;
