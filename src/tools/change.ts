import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenow.js";

async function resolveChangeSysId(client: ServiceNowClient, identifier: string): Promise<string> {
  const trimmed = identifier.trim();
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    return trimmed;
  }
  const results = await client.queryTable("change_request", {
    sysparm_query: `number=${trimmed}`,
    sysparm_limit: 1,
    sysparm_display_value: "false",
  });
  if (!results || results.length === 0) {
    throw new Error(`Change Request with identifier '${trimmed}' not found.`);
  }
  return results[0].sys_id;
}

export function registerChangeTools(server: McpServer, client: ServiceNowClient) {
  server.tool(
    "sn_create_change_request",
    "Create a new ServiceNow Change Request (normal, standard, or emergency) with plans and justification.",
    {
      type: z.enum(["normal", "standard", "emergency"]).describe("Change type: normal, standard, or emergency"),
      short_description: z.string().describe("Short summary of the change"),
      description: z.string().optional().describe("Detailed scope and description of the change"),
      justification: z.string().optional().describe("Business justification for why this change is necessary"),
      implementation_plan: z.string().optional().describe("Step-by-step implementation instructions"),
      backout_plan: z.string().optional().describe("Rollback steps if the change fails"),
      test_plan: z.string().optional().describe("Post-implementation testing and validation steps"),
      risk: z.enum(["1", "2", "3", "4"]).optional().describe("Risk rating: 1 (Very High), 2 (High), 3 (Moderate), 4 (Low)"),
      impact: z.enum(["1", "2", "3"]).optional().describe("Impact rating: 1 (High), 2 (Medium), 3 (Low)"),
      priority: z.enum(["1", "2", "3", "4"]).optional().describe("Priority: 1 (Critical), 2 (High), 3 (Moderate), 4 (Low)"),
      assignment_group: z.string().optional().describe("Change assignment group sys_id or name"),
      assigned_to: z.string().optional().describe("Change owner user sys_id or user_name"),
      start_date: z.string().optional().describe("Planned start date (YYYY-MM-DD HH:MM:SS)"),
      end_date: z.string().optional().describe("Planned end date (YYYY-MM-DD HH:MM:SS)"),
    },
    async (params) => {
      try {
        const payload: Record<string, any> = {
          type: params.type,
          short_description: params.short_description,
        };
        if (params.description) payload.description = params.description;
        if (params.justification) payload.justification = params.justification;
        if (params.implementation_plan) payload.implementation_plan = params.implementation_plan;
        if (params.backout_plan) payload.backout_plan = params.backout_plan;
        if (params.test_plan) payload.test_plan = params.test_plan;
        if (params.risk) payload.risk = params.risk;
        if (params.impact) payload.impact = params.impact;
        if (params.priority) payload.priority = params.priority;
        if (params.assignment_group) payload.assignment_group = params.assignment_group;
        if (params.assigned_to) payload.assigned_to = params.assigned_to;
        if (params.start_date) payload.start_date = params.start_date;
        if (params.end_date) payload.end_date = params.end_date;

        const result = await client.createRecord("change_request", payload);
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
          content: [{ type: "text", text: `Error creating change request: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_get_change_request",
    "Retrieve change request details by number (e.g. CHG0000001) or sys_id.",
    {
      identifier: z.string().describe("Change number (e.g. CHG0030001) or sys_id"),
      fields: z.string().optional().describe("Optional comma-separated list of fields"),
    },
    async ({ identifier, fields }) => {
      try {
        const sysId = await resolveChangeSysId(client, identifier);
        const result = await client.getRecord("change_request", sysId, fields);
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
          content: [{ type: "text", text: `Error retrieving change request '${identifier}': ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_search_change_requests",
    "Search and list change requests with filters (type, state, priority, or query string).",
    {
      query: z.string().optional().describe("Raw encoded query (e.g. 'active=true^ORDERBYDESCsys_created_on')"),
      active: z.boolean().optional().describe("Filter by active status"),
      type: z.enum(["normal", "standard", "emergency"]).optional().describe("Filter by change type"),
      state: z.string().optional().describe("Filter by change state: -5 (New), -4 (Assess), -3 (Authorize), -2 (Scheduled), -1 (Implement), 0 (Review), 3 (Closed), 4 (Canceled)"),
      priority: z.enum(["1", "2", "3", "4"]).optional().describe("Filter by priority"),
      limit: z.number().min(1).max(100).default(10).describe("Maximum records to return"),
      offset: z.number().min(0).default(0).describe("Pagination offset"),
      fields: z.string().optional().describe("Comma-separated list of fields"),
    },
    async (params) => {
      try {
        const queryParts: string[] = [];
        if (params.active !== undefined) queryParts.push(`active=${params.active}`);
        if (params.type) queryParts.push(`type=${params.type}`);
        if (params.state) queryParts.push(`state=${params.state}`);
        if (params.priority) queryParts.push(`priority=${params.priority}`);
        if (params.query) queryParts.push(params.query);

        const defaultFields =
          "sys_id,number,short_description,type,state,priority,risk,requested_by,assigned_to,assignment_group,start_date,end_date,sys_created_on";

        const results = await client.queryTable("change_request", {
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
          content: [{ type: "text", text: `Error searching change requests: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_update_change_request",
    "Update an existing change request (state, notes, schedule, or plans) by number or sys_id.",
    {
      identifier: z.string().describe("Change number (e.g. CHG0030001) or sys_id"),
      state: z.string().optional().describe("Change state code"),
      work_notes: z.string().optional().describe("Internal work notes"),
      comments: z.string().optional().describe("Additional comments"),
      justification: z.string().optional().describe("Updated business justification"),
      implementation_plan: z.string().optional().describe("Updated implementation plan"),
      backout_plan: z.string().optional().describe("Updated backout plan"),
      test_plan: z.string().optional().describe("Updated test plan"),
      start_date: z.string().optional().describe("Updated start date"),
      end_date: z.string().optional().describe("Updated end date"),
      assigned_to: z.string().optional().describe("Assigned technician sys_id or user_name"),
      assignment_group: z.string().optional().describe("Assignment group sys_id or name"),
    },
    async (params) => {
      try {
        const sysId = await resolveChangeSysId(client, params.identifier);
        const payload: Record<string, any> = {};

        if (params.state) payload.state = params.state;
        if (params.work_notes) payload.work_notes = params.work_notes;
        if (params.comments) payload.comments = params.comments;
        if (params.justification) payload.justification = params.justification;
        if (params.implementation_plan) payload.implementation_plan = params.implementation_plan;
        if (params.backout_plan) payload.backout_plan = params.backout_plan;
        if (params.test_plan) payload.test_plan = params.test_plan;
        if (params.start_date) payload.start_date = params.start_date;
        if (params.end_date) payload.end_date = params.end_date;
        if (params.assigned_to) payload.assigned_to = params.assigned_to;
        if (params.assignment_group) payload.assignment_group = params.assignment_group;

        if (Object.keys(payload).length === 0) {
          throw new Error("No update fields provided.");
        }

        const result = await client.updateRecord("change_request", sysId, payload);
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
          content: [{ type: "text", text: `Error updating change request '${params.identifier}': ${err.message}` }],
        };
      }
    }
  );
}
