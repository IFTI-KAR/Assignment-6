import app from "./app";
import { config } from "./config";

// On Vercel the exported app is invoked as a serverless function;
// everywhere else (local, Render, Railway) we start a regular HTTP server.
if (!process.env.VERCEL) {
  const server = app.listen(config.port, () => {
    console.log(`🚑 Ambulance Dispatch API listening on http://localhost:${config.port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down gracefully...`);
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

export default app;
