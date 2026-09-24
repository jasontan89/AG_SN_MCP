import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { config, ServerConfig } from "./config.js";
import { ServiceNowClient } from "./services/servicenow.js";
import { registerAllTools } from "./tools/index.js";

interface ActiveSession {
  server: McpServer;
  transport: SSEServerTransport;
  createdAt: Date;
}

export function createApp(customConfig?: ServerConfig) {
  const cfg = customConfig || config;
  const app = express();
  const serviceNowClient = new ServiceNowClient(cfg);

  // Active MCP SSE sessions mapped by sessionId
  const sessions = new Map<string, ActiveSession>();

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Request logger in non-production environments
  app.use((req, _res, next) => {
    const time = new Date().toISOString();
    console.log(`[${time}] ${req.method} ${req.path}`);
    next();
  });

  /**
   * Root endpoint - metadata and health summary
   */
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "ServiceNow PDI MCP Server",
      description: "Model Context Protocol server for ServiceNow Personal Developer Instances",
      version: "1.0.0",
      status: "online",
      endpoints: {
        sse: "/sse",
        messages: "/messages",
        health: "/health",
      },
      auth: {
        mcpAuthRequired: Boolean(cfg.mcpApiKey),
        serviceNowAuthType: cfg.serviceNow.authType,
        serviceNowInstance: cfg.serviceNow.instanceUrl || "Not configured",
      },
    });
  });

  /**
   * Health Check Endpoint
   * Used by Render deployment health checks, external cron jobs, and Uptime monitors
   */
  app.get("/health", async (_req: Request, res: Response) => {
    const uptimeSec = Math.floor(process.uptime());
    res.json({
      status: "healthy",
      uptime: `${uptimeSec}s`,
      timestamp: new Date().toISOString(),
      activeMcpSessions: sessions.size,
      serviceNowInstance: cfg.serviceNow.instanceUrl,
    });
  });

  /**
   * Authentication Middleware for MCP endpoints
   * Supports:
   * - Authorization: Bearer <key>
   * - x-api-key: <key>
   * - URL Query parameter: ?token=<key> or ?apiKey=<key>
   */
  const authenticateMcp = (req: Request, res: Response, next: NextFunction): void => {
    // If no API key is configured on server, permit all (development mode)
    if (!cfg.mcpApiKey) {
      return next();
    }

    const authHeader = req.headers.authorization;
    let providedKey = "";

    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      providedKey = authHeader.slice(7).trim();
    } else if (req.headers["x-api-key"]) {
      providedKey = String(req.headers["x-api-key"]).trim();
    } else if (req.query.token) {
      providedKey = String(req.query.token).trim();
    } else if (req.query.apiKey) {
      providedKey = String(req.query.apiKey).trim();
    }

    if (!providedKey || providedKey !== cfg.mcpApiKey) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Invalid or missing MCP API key. Provide Bearer token or ?token= query parameter.",
      });
      return;
    }

    next();
  };

  /**
   * GET /sse
   * Establishes the Server-Sent Events stream for an MCP client connection
   */
  app.get("/sse", authenticateMcp, async (req: Request, res: Response) => {
    try {
      console.log("[SSE] Initializing new client SSE connection...");

      // Initialize dedicated McpServer instance for this connection
      const server = new McpServer({
        name: "servicenow-mcp-server",
        version: "1.0.0",
      });

      // Register all ServiceNow tools
      registerAllTools(server, serviceNowClient);

      // Construct SSE server transport pointing to /messages
      const transport = new SSEServerTransport("/messages", res);
      const sessionId = transport.sessionId;

      sessions.set(sessionId, {
        server,
        transport,
        createdAt: new Date(),
      });

      console.log(`[SSE] Session started: ${sessionId}. Total active sessions: ${sessions.size}`);

      // Handle connection termination
      res.on("close", async () => {
        console.log(`[SSE] Connection closed for session: ${sessionId}`);
        try {
          await transport.close();
          await server.close();
        } catch (closeErr) {
          console.error(`[SSE] Error during session cleanup:`, closeErr);
        } finally {
          sessions.delete(sessionId);
          console.log(`[SSE] Cleaned up session: ${sessionId}. Remaining sessions: ${sessions.size}`);
        }
      });

      // Connect transport to McpServer
      await server.connect(transport);
    } catch (err: any) {
      console.error("[SSE] Connection initialization failed:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to establish SSE stream", detail: err.message });
      }
    }
  });

  /**
   * POST /messages
   * Receives incoming JSON-RPC messages from the client
   */
  app.post("/messages", authenticateMcp, async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      res.status(400).json({ error: "Missing sessionId query parameter" });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      console.warn(`[Messages] Session not found or expired: ${sessionId}`);
      res.status(404).json({ error: "Session not found or expired. Please reconnect to /sse." });
      return;
    }

    try {
      // Pass the parsed req.body directly to avoid duplicate stream reads in Express
      await session.transport.handlePostMessage(req, res, req.body);
    } catch (err: any) {
      console.error(`[Messages] Error handling post message for session ${sessionId}:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal error handling message", detail: err.message });
      }
    }
  });

  return { app, sessions, serviceNowClient };
}
