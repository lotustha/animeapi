import { createApp } from "./app.js";
import { validateConfig } from "./core/config.js";

validateConfig();

const app = await createApp();

if (process.env.NODE_ENV !== "production") {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
    });
}

export default app;
