import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServiceNowClient } from "../services/servicenow.js";
import { registerIncidentTools } from "./incident.js";
import { registerChangeTools } from "./change.js";
import { registerProblemTools } from "./problem.js";
import { registerKnowledgeTools } from "./knowledge.js";
import { registerUserGroupTools } from "./user_group.js";
import { registerTableApiTools } from "./table_api.js";
import { registerAttachmentTools } from "./attachment.js";

export function registerAllTools(server: McpServer, client: ServiceNowClient) {
  // Register ServiceNow connection health check tool
  server.tool(
    "sn_health_check",
    "Check connectivity and authentication status with the configured ServiceNow PDI instance.",
    {},
    async () => {
      const startTime = Date.now();
      const status = await client.ping();
      const durationMs = Date.now() - startTime;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                connected: status.ok,
                message: status.message,
                responseTimeMs: durationMs,
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Register domain module tools
  registerIncidentTools(server, client);
  registerChangeTools(server, client);
  registerProblemTools(server, client);
  registerKnowledgeTools(server, client);
  registerUserGroupTools(server, client);
  registerTableApiTools(server, client);
  registerAttachmentTools(server, client);
}
