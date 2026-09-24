import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { config, ServerConfig } from "./config.js";
import { ServiceNowClient } from "./services/servicenow.js";
import { registerAllTools } from "./tools/index.js";

interface SseSession {
  server: McpServer;
  transport: SSEServerTransport;
  createdAt: Date;
}

export function createApp(customConfig?: ServerConfig) {
  const cfg = customConfig || config;
  const app = express();
  const serviceNowClient = new ServiceNowClient(cfg);

  // Active MCP sessions
  const sseSessions = new Map<string, SseSession>();
  const streamableTransports = new Map<string, StreamableHTTPServerTransport>();

  app.use(cors());
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    next();
  });
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Request logger
  app.use((req, _res, next) => {
    const time = new Date().toISOString();
    console.log(`[${time}] ${req.method} ${req.path}`);
    next();
  });

  /**
   * Helper to create a fully configured McpServer instance
   */
  function createMcpServerInstance(): McpServer {
    const server = new McpServer({
      name: "servicenow-mcp-server",
      version: "1.0.0",
    });
    registerAllTools(server, serviceNowClient);
    return server;
  }

  /**
   * Authentication Middleware for MCP endpoints
   * Supports:
   * - Authorization: Bearer <key>
   * - x-api-key: <key>
   * - URL Query parameter: ?token=<key> or ?apiKey=<key> (handles base64 '+' and URL encoding)
   * - Valid active session bypass (for established sessions)
   */
  const authenticateMcp = (req: Request, res: Response, next: NextFunction): void => {
    if (!cfg.mcpApiKey) {
      return next();
    }

    // If request carries a known valid active sessionId, permit
    const activeSessionId = (req.headers["mcp-session-id"] || req.query.sessionId) as string;
    if (activeSessionId && (streamableTransports.has(activeSessionId) || sseSessions.has(activeSessionId))) {
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

    const expectedKey = cfg.mcpApiKey;
    const isKeyMatch =
      providedKey === expectedKey ||
      providedKey.replace(/ /g, "+") === expectedKey ||
      decodeURIComponent(providedKey) === expectedKey;

    if (!isKeyMatch) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Invalid or missing MCP API key. Provide Bearer token or ?token= query parameter.",
      });
      return;
    }

    next();
  };

  /**
   * Root endpoint - metadata and health summary
   */
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      name: "ServiceNow PDI MCP Server",
      description: "Model Context Protocol server for ServiceNow Personal Developer Instances",
      version: "1.0.0",
      status: "online",
      transports: ["streamable-http", "http-sse"],
      endpoints: {
        streamableHttp: "/mcp",
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
      activeSseSessions: sseSessions.size,
      activeStreamableSessions: streamableTransports.size,
      serviceNowInstance: cfg.serviceNow.instanceUrl,
    });
  });

  //=============================================================================
  // STREAMABLE HTTP TRANSPORT (Antigravity, Cursor, & Modern MCP Clients)
  //=============================================================================
  const handleStreamableHttp = async (req: Request, res: Response) => {
    try {
      // Ensure accept header always contains both required MIME types for MCP Streamable HTTP spec
      req.headers.accept = "application/json, text/event-stream";

      const sessionId = (req.headers["mcp-session-id"] || req.query.sessionId) as string;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && streamableTransports.has(sessionId)) {
        transport = streamableTransports.get(sessionId)!;
      } else if (isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            console.log(`[StreamableHTTP] Session initialized: ${sid}`);
            streamableTransports.set(sid, transport);
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && streamableTransports.has(sid)) {
            console.log(`[StreamableHTTP] Session closed: ${sid}`);
            streamableTransports.delete(sid);
          }
        };

        const server = createMcpServerInstance();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        // Stateless fallback
        const server = createMcpServerInstance();
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      console.error("[StreamableHTTP] Error handling request:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error: " + err.message,
          },
          id: null,
        });
      }
    }
  };

  // Mount Streamable HTTP on both /mcp and /sse (POST)
  app.post("/mcp", authenticateMcp, handleStreamableHttp);
  app.post("/sse", authenticateMcp, handleStreamableHttp);
  app.all("/mcp", authenticateMcp, async (req: Request, res: Response) => {
    if (req.method === "POST") return handleStreamableHttp(req, res);
    res.status(405).set("Allow", "POST").send("Method Not Allowed. Use POST for Streamable HTTP.");
  });

  //=============================================================================
  // TRADITIONAL HTTP + SSE TRANSPORT (Claude Desktop, etc.)
  //=============================================================================
  /**
   * GET /sse
   * Establishes the Server-Sent Events stream for traditional SSE MCP clients
   */
  app.get("/sse", authenticateMcp, async (req: Request, res: Response) => {
    try {
      console.log("[SSE] Initializing new client SSE connection...");

      const server = createMcpServerInstance();

      // Preserve token in endpoint query so subsequent POST /messages carries the token
      const tokenParam = req.query.token ? `?token=${encodeURIComponent(String(req.query.token))}` : "";
      const transport = new SSEServerTransport(`/messages${tokenParam}`, res);
      const sessionId = transport.sessionId;

      sseSessions.set(sessionId, {
        server,
        transport,
        createdAt: new Date(),
      });

      console.log(`[SSE] Session started: ${sessionId}. Total active SSE sessions: ${sseSessions.size}`);

      res.on("close", async () => {
        console.log(`[SSE] Connection closed for session: ${sessionId}`);
        try {
          await transport.close();
          await server.close();
        } catch (closeErr) {
          console.error(`[SSE] Error during session cleanup:`, closeErr);
        } finally {
          sseSessions.delete(sessionId);
          console.log(`[SSE] Cleaned up session: ${sessionId}. Remaining SSE sessions: ${sseSessions.size}`);
        }
      });

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
   * Receives incoming JSON-RPC messages for established SSE sessions
   */
  app.post("/messages", authenticateMcp, async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;

    if (!sessionId) {
      res.status(400).json({ error: "Missing sessionId query parameter" });
      return;
    }

    const session = sseSessions.get(sessionId);
    if (!session) {
      console.warn(`[Messages] Session not found or expired: ${sessionId}`);
      res.status(404).json({ error: "Session not found or expired. Please reconnect to /sse." });
      return;
    }

    try {
      await session.transport.handlePostMessage(req, res, req.body);
    } catch (err: any) {
      console.error(`[Messages] Error handling post message for session ${sessionId}:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal error handling message", detail: err.message });
      }
    }
  });

  return { app, sseSessions, streamableTransports, serviceNowClient };
}
