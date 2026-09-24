import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenow.js";

async function resolveKnowledgeSysId(client: ServiceNowClient, identifier: string): Promise<string> {
  const trimmed = identifier.trim();
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    return trimmed;
  }
  const results = await client.queryTable("kb_knowledge", {
    sysparm_query: `number=${trimmed}`,
    sysparm_limit: 1,
    sysparm_display_value: "false",
  });
  if (!results || results.length === 0) {
    throw new Error(`Knowledge Article with identifier '${trimmed}' not found.`);
  }
  return results[0].sys_id;
}

export function registerKnowledgeTools(server: McpServer, client: ServiceNowClient) {
  server.tool(
    "sn_search_knowledge_articles",
    "Search published ServiceNow Knowledge Base articles by keywords, topics, or categories.",
    {
      keyword: z.string().optional().describe("Search keywords to match against article title and text content"),
      topic: z.string().optional().describe("Topic filter"),
      category: z.string().optional().describe("Category filter"),
      workflow_state: z.string().default("published").describe("Workflow state (default: 'published')"),
      limit: z.number().min(1).max(50).default(5).describe("Maximum number of articles to return"),
      offset: z.number().min(0).default(0).describe("Pagination offset"),
      fields: z.string().optional().describe("Comma-separated fields to return"),
    },
    async (params) => {
      try {
        const queryParts: string[] = [];

        if (params.workflow_state) {
          queryParts.push(`workflow_state=${params.workflow_state}`);
        }
        if (params.topic) {
          queryParts.push(`topic=${params.topic}`);
        }
        if (params.category) {
          queryParts.push(`kb_category=${params.category}`);
        }
        if (params.keyword) {
          queryParts.push(`short_descriptionLIKE${params.keyword}^ORtextLIKE${params.keyword}`);
        }

        const defaultFields =
          "sys_id,number,short_description,topic,kb_category,workflow_state,published,sys_view_count,text";

        const results = await client.queryTable("kb_knowledge", {
          sysparm_query: queryParts.length > 0 ? queryParts.join("^") : "ORDERBYDESCsys_view_count",
          sysparm_limit: params.limit,
          sysparm_offset: params.offset,
          sysparm_fields: params.fields || defaultFields,
          sysparm_display_value: "all",
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error searching knowledge base: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_get_knowledge_article",
    "Retrieve the full content and metadata of a knowledge article by its number (e.g. KB0000001) or sys_id.",
    {
      identifier: z.string().describe("Article number (e.g. KB0010001) or sys_id"),
      fields: z.string().optional().describe("Comma-separated fields to retrieve"),
    },
    async ({ identifier, fields }) => {
      try {
        const sysId = await resolveKnowledgeSysId(client, identifier);
        const result = await client.getRecord("kb_knowledge", sysId, fields);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error retrieving knowledge article '${identifier}': ${err.message}` }],
        };
      }
    }
  );
}
