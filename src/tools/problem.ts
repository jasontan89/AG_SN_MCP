import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenow.js";

async function resolveProblemSysId(client: ServiceNowClient, identifier: string): Promise<string> {
  const trimmed = identifier.trim();
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    return trimmed;
  }
  const results = await client.queryTable("problem", {
    sysparm_query: `number=${trimmed}`,
    sysparm_limit: 1,
    sysparm_display_value: "false",
  });
  if (!results || results.length === 0) {
    throw new Error(`Problem with identifier '${trimmed}' not found.`);
  }
  return results[0].sys_id;
}

export function registerProblemTools(server: McpServer, client: ServiceNowClient) {
  server.tool(
    "sn_create_problem",
    "Create a new ServiceNow Problem record to investigate root cause.",
    {
      short_description: z.string().describe("Summary of the problem"),
      description: z.string().optional().describe("Detailed description of the underlying problem symptoms"),
      urgency: z.enum(["1", "2", "3"]).optional().describe("Urgency: 1 (High), 2 (Medium), 3 (Low)"),
      impact: z.enum(["1", "2", "3"]).optional().describe("Impact: 1 (High), 2 (Medium), 3 (Low)"),
      priority: z.enum(["1", "2", "3", "4", "5"]).optional().describe("Priority"),
      assignment_group: z.string().optional().describe("Assignment group sys_id or name"),
      assigned_to: z.string().optional().describe("Problem manager/owner sys_id or user_name"),
      workaround: z.string().optional().describe("Known temporary workaround"),
      cause_notes: z.string().optional().describe("Root cause analysis notes"),
    },
    async (params) => {
      try {
        const payload: Record<string, any> = {
          short_description: params.short_description,
        };
        if (params.description) payload.description = params.description;
        if (params.urgency) payload.urgency = params.urgency;
        if (params.impact) payload.impact = params.impact;
        if (params.priority) payload.priority = params.priority;
        if (params.assignment_group) payload.assignment_group = params.assignment_group;
        if (params.assigned_to) payload.assigned_to = params.assigned_to;
        if (params.workaround) payload.workaround = params.workaround;
        if (params.cause_notes) payload.cause_notes = params.cause_notes;

        const result = await client.createRecord("problem", payload);
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
          content: [{ type: "text", text: `Error creating problem: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_get_problem",
    "Retrieve problem details by problem number (e.g. PRB0000001) or sys_id.",
    {
      identifier: z.string().describe("Problem number (e.g. PRB0040001) or sys_id"),
      fields: z.string().optional().describe("Optional comma-separated list of fields"),
    },
    async ({ identifier, fields }) => {
      try {
        const sysId = await resolveProblemSysId(client, identifier);
        const result = await client.getRecord("problem", sysId, fields);
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
          content: [{ type: "text", text: `Error retrieving problem '${identifier}': ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_search_problems",
    "Search and list problems with state, priority, and query filters.",
    {
      query: z.string().optional().describe("Raw encoded query (e.g. 'active=true^ORDERBYDESCsys_created_on')"),
      active: z.boolean().optional().describe("Filter by active status"),
      state: z.string().optional().describe("Problem state: 101 (New), 102 (Assess), 103 (Root Cause Analysis), 104 (Fix in Progress), 106 (Resolved), 107 (Closed)"),
      priority: z.enum(["1", "2", "3", "4", "5"]).optional().describe("Priority filter"),
      limit: z.number().min(1).max(100).default(10).describe("Maximum records to return"),
      offset: z.number().min(0).default(0).describe("Pagination offset"),
      fields: z.string().optional().describe("Comma-separated list of fields"),
    },
    async (params) => {
      try {
        const queryParts: string[] = [];
        if (params.active !== undefined) queryParts.push(`active=${params.active}`);
        if (params.state) queryParts.push(`state=${params.state}`);
        if (params.priority) queryParts.push(`priority=${params.priority}`);
        if (params.query) queryParts.push(params.query);

        const defaultFields =
          "sys_id,number,short_description,state,priority,urgency,impact,assigned_to,assignment_group,workaround,sys_created_on";

        const results = await client.queryTable("problem", {
          sysparm_query: queryParts.length > 0 ? queryParts.join("^") : "ORDERBYDESCsys_created_on",
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
          content: [{ type: "text", text: `Error searching problems: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_update_problem",
    "Update an existing problem record (workaround, root cause, state, or resolution).",
    {
      identifier: z.string().describe("Problem number or sys_id"),
      state: z.string().optional().describe("Problem state code"),
      workaround: z.string().optional().describe("Workaround description"),
      cause_notes: z.string().optional().describe("Root cause analysis"),
      resolution_code: z.string().optional().describe("Resolution code"),
      resolution_notes: z.string().optional().describe("Resolution notes"),
      work_notes: z.string().optional().describe("Internal work notes"),
      assigned_to: z.string().optional().describe("Assigned user sys_id or user_name"),
    },
    async (params) => {
      try {
        const sysId = await resolveProblemSysId(client, params.identifier);
        const payload: Record<string, any> = {};

        if (params.state) payload.state = params.state;
        if (params.workaround) payload.workaround = params.workaround;
        if (params.cause_notes) payload.cause_notes = params.cause_notes;
        if (params.resolution_code) payload.resolution_code = params.resolution_code;
        if (params.resolution_notes) payload.resolution_notes = params.resolution_notes;
        if (params.work_notes) payload.work_notes = params.work_notes;
        if (params.assigned_to) payload.assigned_to = params.assigned_to;

        if (Object.keys(payload).length === 0) {
          throw new Error("No update fields provided.");
        }

        const result = await client.updateRecord("problem", sysId, payload);
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
          content: [{ type: "text", text: `Error updating problem '${params.identifier}': ${err.message}` }],
        };
      }
    }
  );
}
