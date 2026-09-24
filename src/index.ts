import { config } from "./config.js";
import { createApp } from "./server.js";

const { app } = createApp();

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log("==================================================================");
  console.log("       ServiceNow PDI Model Context Protocol (MCP) Server         ");
  console.log("==================================================================");
  console.log(` Server running on        : http://0.0.0.0:${config.port}`);
  console.log(` SSE Connection URL       : http://localhost:${config.port}/sse`);
  console.log(` Health Check URL         : http://localhost:${config.port}/health`);
  console.log("------------------------------------------------------------------");
  console.log(` ServiceNow Instance      : ${config.serviceNow.instanceUrl || "(Not set)"}`);
  console.log(` ServiceNow Auth Type     : ${config.serviceNow.authType.toUpperCase()}`);
  if (config.serviceNow.authType === "oauth") {
    console.log(` OAuth Grant Type         : ${config.serviceNow.oauthGrantType}`);
    console.log(` OAuth Client ID          : ${config.serviceNow.clientId ? config.serviceNow.clientId.slice(0, 8) + "..." : "(Not set)"}`);
  }
  console.log("------------------------------------------------------------------");
  if (config.mcpApiKey) {
    console.log(` MCP Authentication       : ENABLED (Bearer token / ?token= required)`);
  } else {
    console.log(` MCP Authentication       : WARNING: MCP_API_KEY is empty. Open access!`);
  }
  console.log("==================================================================");
  console.log("Ready to accept connections from Claude Desktop, Antigravity, Cursor, etc.");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});
