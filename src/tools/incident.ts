import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenow.js";

async function resolveIncidentSysId(client: ServiceNowClient, identifier: string): Promise<string> {
  const trimmed = identifier.trim();
  // If it's already a 32-character sys_id
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    return trimmed;
  }
  // Otherwise search by number (e.g., INC0010001)
  const results = await client.queryTable("incident", {
    sysparm_query: `number=${trimmed}`,
    sysparm_limit: 1,
    sysparm_display_value: "false",
  });
  if (!results || results.length === 0) {
    throw new Error(`Incident with identifier/number '${trimmed}' not found.`);
  }
  return results[0].sys_id;
}

export function registerIncidentTools(server: McpServer, client: ServiceNowClient) {
  server.tool(
    "sn_create_incident",
    "Create a new ServiceNow incident ticket with caller, description, urgency, impact, category, and assignment.",
    {
      short_description: z.string().describe("A brief summary of the issue"),
      description: z.string().optional().describe("Detailed description of the incident symptoms and context"),
      urgency: z.enum(["1", "2", "3"]).optional().describe("1 (High), 2 (Medium), 3 (Low)"),
      impact: z.enum(["1", "2", "3"]).optional().describe("1 (High), 2 (Medium), 3 (Low)"),
      caller_id: z.string().optional().describe("User sys_id or user_name of the caller"),
      category: z.string().optional().describe("Category e.g., 'inquiry', 'software', 'hardware', 'network', 'database'"),
      subcategory: z.string().optional().describe("Subcategory under the chosen category"),
      assignment_group: z.string().optional().describe("Name or sys_id of the assignment group"),
      assigned_to: z.string().optional().describe("sys_id or user_name of the assigned technician"),
      work_notes: z.string().optional().describe("Internal work notes visible only to technicians"),
      comments: z.string().optional().describe("Customer-visible additional comments"),
    },
    async (params) => {
      try {
        const payload: Record<string, any> = {
          short_description: params.short_description,
        };
        if (params.description) payload.description = params.description;
        if (params.urgency) payload.urgency = params.urgency;
        if (params.impact) payload.impact = params.impact;
        if (params.caller_id) payload.caller_id = params.caller_id;
        if (params.category) payload.category = params.category;
        if (params.subcategory) payload.subcategory = params.subcategory;
        if (params.assignment_group) payload.assignment_group = params.assignment_group;
        if (params.assigned_to) payload.assigned_to = params.assigned_to;
        if (params.work_notes) payload.work_notes = params.work_notes;
        if (params.comments) payload.comments = params.comments;

        const result = await client.createRecord("incident", payload);
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
          content: [{ type: "text", text: `Error creating incident: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_get_incident",
    "Retrieve incident details using its incident number (e.g. INC0000001) or 32-character sys_id.",
    {
      identifier: z.string().describe("Incident number (e.g. INC0010001) or sys_id"),
      fields: z.string().optional().describe("Optional comma-separated list of field names to return"),
    },
    async ({ identifier, fields }) => {
      try {
        const sysId = await resolveIncidentSysId(client, identifier);
        const result = await client.getRecord("incident", sysId, fields);
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
          content: [{ type: "text", text: `Error retrieving incident '${identifier}': ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_search_incidents",
    "Search and list incidents with filters (active, state, priority, assigned_to, assignment_group, or raw encoded query).",
    {
      query: z.string().optional().describe("Optional raw ServiceNow encoded query (e.g., 'active=true^ORDERBYDESCsys_created_on')"),
      active: z.boolean().optional().describe("Filter by active status"),
      state: z.string().optional().describe("Filter by incident state: 1 (New), 2 (In Progress), 3 (On Hold), 6 (Resolved), 7 (Closed), 8 (Canceled)"),
      priority: z.enum(["1", "2", "3", "4", "5"]).optional().describe("Filter by priority: 1 (Critical), 2 (High), 3 (Moderate), 4 (Low), 5 (Planning)"),
      assigned_to: z.string().optional().describe("Filter by assigned user sys_id or user_name"),
      assignment_group: z.string().optional().describe("Filter by assignment group sys_id or group name"),
      limit: z.number().min(1).max(100).default(10).describe("Maximum number of incidents to return (default: 10)"),
      offset: z.number().min(0).default(0).describe("Pagination offset (default: 0)"),
      fields: z.string().optional().describe("Comma-separated list of fields (defaults to essential incident fields)"),
    },
    async (params) => {
      try {
        const queryParts: string[] = [];

        if (params.active !== undefined) {
          queryParts.push(`active=${params.active}`);
        }
        if (params.state) {
          queryParts.push(`state=${params.state}`);
        }
        if (params.priority) {
          queryParts.push(`priority=${params.priority}`);
        }
        if (params.assigned_to) {
          queryParts.push(`assigned_to=${params.assigned_to}`);
        }
        if (params.assignment_group) {
          queryParts.push(`assignment_group=${params.assignment_group}`);
        }
        if (params.query) {
          queryParts.push(params.query);
        }

        const defaultFields =
          "sys_id,number,short_description,state,priority,urgency,impact,caller_id,assigned_to,assignment_group,category,sys_created_on,sys_updated_on";

        const results = await client.queryTable("incident", {
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
          content: [{ type: "text", text: `Error searching incidents: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_update_incident",
    "Update an existing incident (work notes, state, assigned_to, priority, etc.) by number or sys_id.",
    {
      identifier: z.string().describe("Incident number (e.g. INC0010001) or sys_id"),
      state: z.string().optional().describe("Incident state: 1 (New), 2 (In Progress), 3 (On Hold), 6 (Resolved), 7 (Closed), 8 (Canceled)"),
      work_notes: z.string().optional().describe("Internal work notes to add"),
      comments: z.string().optional().describe("Customer-facing comments to add"),
      assigned_to: z.string().optional().describe("Technician sys_id or user_name"),
      assignment_group: z.string().optional().describe("Group sys_id or name"),
      urgency: z.enum(["1", "2", "3"]).optional().describe("Urgency 1 (High), 2 (Medium), 3 (Low)"),
      impact: z.enum(["1", "2", "3"]).optional().describe("Impact 1 (High), 2 (Medium), 3 (Low)"),
      short_description: z.string().optional().describe("Updated short description"),
      description: z.string().optional().describe("Updated description"),
    },
    async (params) => {
      try {
        const sysId = await resolveIncidentSysId(client, params.identifier);
        const payload: Record<string, any> = {};

        if (params.state) payload.state = params.state;
        if (params.work_notes) payload.work_notes = params.work_notes;
        if (params.comments) payload.comments = params.comments;
        if (params.assigned_to) payload.assigned_to = params.assigned_to;
        if (params.assignment_group) payload.assignment_group = params.assignment_group;
        if (params.urgency) payload.urgency = params.urgency;
        if (params.impact) payload.impact = params.impact;
        if (params.short_description) payload.short_description = params.short_description;
        if (params.description) payload.description = params.description;

        if (Object.keys(payload).length === 0) {
          throw new Error("No update fields provided.");
        }

        const result = await client.updateRecord("incident", sysId, payload);
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
          content: [{ type: "text", text: `Error updating incident '${params.identifier}': ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_resolve_incident",
    "Resolve an incident with mandatory resolution code and close notes.",
    {
      identifier: z.string().describe("Incident number (e.g. INC0010001) or sys_id"),
      close_code: z
        .string()
        .describe("Resolution code, e.g. 'Solved (Work Around)', 'Solved (Permanently)', 'Solved by Change', 'Not Solved (Not Reproducible)'"),
      close_notes: z.string().describe("Explanation of how the issue was resolved"),
      work_notes: z.string().optional().describe("Optional internal work notes"),
    },
    async ({ identifier, close_code, close_notes, work_notes }) => {
      try {
        const sysId = await resolveIncidentSysId(client, identifier);
        const payload: Record<string, any> = {
          state: "6", // 6 is Resolved in standard ServiceNow
          close_code,
          close_notes,
        };
        if (work_notes) {
          payload.work_notes = work_notes;
        }

        const result = await client.updateRecord("incident", sysId, payload);
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
          content: [{ type: "text", text: `Error resolving incident '${identifier}': ${err.message}` }],
        };
      }
    }
  );
}
