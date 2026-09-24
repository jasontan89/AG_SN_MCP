import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenow.js";

async function resolveUserSysId(client: ServiceNowClient, identifier: string): Promise<string> {
  const trimmed = identifier.trim();
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    return trimmed;
  }
  // Try by user_name or email
  const results = await client.queryTable("sys_user", {
    sysparm_query: `user_name=${trimmed}^ORemail=${trimmed}`,
    sysparm_limit: 1,
    sysparm_display_value: "false",
  });
  if (!results || results.length === 0) {
    throw new Error(`User '${trimmed}' not found.`);
  }
  return results[0].sys_id;
}

async function resolveGroupSysId(client: ServiceNowClient, identifier: string): Promise<string> {
  const trimmed = identifier.trim();
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    return trimmed;
  }
  const results = await client.queryTable("sys_user_group", {
    sysparm_query: `name=${trimmed}`,
    sysparm_limit: 1,
    sysparm_display_value: "false",
  });
  if (!results || results.length === 0) {
    throw new Error(`Group '${trimmed}' not found.`);
  }
  return results[0].sys_id;
}

export function registerUserGroupTools(server: McpServer, client: ServiceNowClient) {
  server.tool(
    "sn_search_users",
    "Search ServiceNow users (sys_user) by name, username, or email.",
    {
      search_term: z.string().describe("Search term matching against user_name, name, or email"),
      active: z.boolean().optional().describe("Filter active users only (default: true)"),
      limit: z.number().min(1).max(50).default(10).describe("Maximum records to return"),
      fields: z.string().optional().describe("Comma-separated fields"),
    },
    async ({ search_term, active = true, limit, fields }) => {
      try {
        const queryParts: string[] = [];
        if (active !== undefined) queryParts.push(`active=${active}`);
        queryParts.push(`nameLIKE${search_term}^ORuser_nameLIKE${search_term}^ORemailLIKE${search_term}`);

        const defaultFields =
          "sys_id,user_name,name,first_name,last_name,email,phone,mobile_phone,department,title,active";

        const results = await client.queryTable("sys_user", {
          sysparm_query: queryParts.join("^"),
          sysparm_limit: limit,
          sysparm_fields: fields || defaultFields,
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
          content: [{ type: "text", text: `Error searching users: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_get_user",
    "Retrieve complete user profile details by username, email, or sys_id.",
    {
      identifier: z.string().describe("User sys_id, user_name, or email address"),
      fields: z.string().optional().describe("Comma-separated fields to return"),
    },
    async ({ identifier, fields }) => {
      try {
        const sysId = await resolveUserSysId(client, identifier);
        const result = await client.getRecord("sys_user", sysId, fields);
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
          content: [{ type: "text", text: `Error retrieving user '${identifier}': ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_search_groups",
    "Search ServiceNow assignment groups (sys_user_group) by name or keyword.",
    {
      search_term: z.string().optional().describe("Keyword or group name to search for"),
      active: z.boolean().optional().describe("Filter active groups"),
      limit: z.number().min(1).max(50).default(10).describe("Maximum records to return"),
      fields: z.string().optional().describe("Comma-separated fields"),
    },
    async ({ search_term, active = true, limit, fields }) => {
      try {
        const queryParts: string[] = [];
        if (active !== undefined) queryParts.push(`active=${active}`);
        if (search_term) queryParts.push(`nameLIKE${search_term}^ORdescriptionLIKE${search_term}`);

        const defaultFields = "sys_id,name,description,manager,email,active";

        const results = await client.queryTable("sys_user_group", {
          sysparm_query: queryParts.length > 0 ? queryParts.join("^") : "ORDERBYname",
          sysparm_limit: limit,
          sysparm_fields: fields || defaultFields,
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
          content: [{ type: "text", text: `Error searching groups: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_get_group_members",
    "Get all active member users belonging to a specific assignment group.",
    {
      group_identifier: z.string().describe("Group sys_id or exact group name (e.g. 'Network', 'Service Desk')"),
      limit: z.number().min(1).max(100).default(20).describe("Maximum members to return"),
    },
    async ({ group_identifier, limit }) => {
      try {
        const groupSysId = await resolveGroupSysId(client, group_identifier);

        // Query sys_user_grmember linking table
        const memberships = await client.queryTable("sys_user_grmember", {
          sysparm_query: `group=${groupSysId}^user.active=true`,
          sysparm_limit: limit,
          sysparm_fields: "user.sys_id,user.name,user.user_name,user.email,user.title",
          sysparm_display_value: "all",
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(memberships, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error getting group members: ${err.message}` }],
        };
      }
    }
  );
}
