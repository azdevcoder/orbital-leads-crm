import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { ensureAdminUser } from "../db";
import { handleCaktoWebhook, isValidCaktoSecret } from "../cakto";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) return;
  try {
    await ensureAdminUser(email, password);
    console.log(`[Admin] conta administradora garantida para ${email}`);
  } catch (error) {
    console.warn("[Admin] não foi possível garantir a conta administradora:", error);
  }
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  // Sem VITE_APP_ID os tokens saem com appId vazio e TODA sessão é rejeitada.
  if (!process.env.VITE_APP_ID) {
    console.warn("[Auth] VITE_APP_ID ausente: defina no .env ou as sessões falharão.");
  }
  // Atrás do Cloudflare Tunnel: req.protocol reflete X-Forwarded-Proto.
  app.set("trust proxy", 1);
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  // Webhook Cakto (pagamentos): responde 2xx de imediato e processa em seguida.
  app.post("/api/cakto/webhook", async (req, res) => {
    const body = (req.body ?? {}) as { secret?: unknown; event?: unknown; data?: unknown };
    if (!isValidCaktoSecret(body.secret)) {
      res.status(401).json({ ok: false });
      return;
    }
    res.status(200).json({ ok: true });
    handleCaktoWebhook(body.event, body.data).catch(error =>
      console.error("[Cakto] webhook failed", error)
    );
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  await ensureAdmin();

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
