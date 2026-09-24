import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenow.js";

function parseJsonPayload(input: string | Record<string, any>): Record<string, any> {
  if (typeof input === "object" && input !== null) {
    return input;
  }
  try {
    return JSON.parse(input);
  } catch (e: any) {
    throw new Error(`Invalid JSON provided for record data: ${e.message}`);
  }
}

export function registerTableApiTools(server: McpServer, client: ServiceNowClient) {
  server.tool(
    "sn_query_table",
    "Perform a generic query against ANY ServiceNow table (e.g., cmdb_ci, sc_req_item, sys_user, cmn_location, etc.) using encoded query syntax.",
    {
      table_name: z.string().describe("ServiceNow table name (e.g., 'cmdb_ci', 'sc_req_item', 'sc_task', 'problem_task')"),
      query: z.string().optional().describe("ServiceNow encoded query string (e.g., 'active=true^nameLIKEweb')"),
      limit: z.number().min(1).max(100).default(10).describe("Maximum number of records to retrieve"),
      offset: z.number().min(0).default(0).describe("Offset for pagination"),
      fields: z.string().optional().describe("Comma-separated list of field names to return"),
      display_value: z.enum(["all", "true", "false"]).default("all").describe("Return display values, raw values, or both ('all')"),
    },
    async ({ table_name, query, limit, offset, fields, display_value }) => {
      try {
        const results = await client.queryTable(table_name, {
          sysparm_query: query,
          sysparm_limit: limit,
          sysparm_offset: offset,
          sysparm_fields: fields,
          sysparm_display_value: display_value,
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
          content: [{ type: "text", text: `Error querying table '${table_name}': ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_get_record",
    "Retrieve a single record from ANY ServiceNow table by its sys_id.",
    {
      table_name: z.string().describe("ServiceNow table name"),
      sys_id: z.string().describe("The 32-character sys_id of the record"),
      fields: z.string().optional().describe("Comma-separated field names to return"),
      display_value: z.enum(["all", "true", "false"]).default("all").describe("Display value mode"),
    },
    async ({ table_name, sys_id, fields, display_value }) => {
      try {
        const result = await client.getRecord(table_name, sys_id, fields, display_value);
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
          content: [{ type: "text", text: `Error retrieving record from '${table_name}': ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_create_record",
    "Create a new record in ANY ServiceNow table with specified field values.",
    {
      table_name: z.string().describe("ServiceNow table name"),
      data_json: z.string().describe("JSON string of key-value pairs representing the fields of the new record"),
    },
    async ({ table_name, data_json }) => {
      try {
        const recordData = parseJsonPayload(data_json);
        const result = await client.createRecord(table_name, recordData);
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
          content: [{ type: "text", text: `Error creating record in '${table_name}': ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_update_record",
    "Update an existing record in ANY ServiceNow table by sys_id.",
    {
      table_name: z.string().describe("ServiceNow table name"),
      sys_id: z.string().describe("The 32-character sys_id of the record to update"),
      data_json: z.string().describe("JSON string of key-value pairs representing fields to update"),
    },
    async ({ table_name, sys_id, data_json }) => {
      try {
        const recordData = parseJsonPayload(data_json);
        const result = await client.updateRecord(table_name, sys_id, recordData);
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
          content: [{ type: "text", text: `Error updating record in '${table_name}': ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_delete_record",
    "Delete a record from ANY ServiceNow table by sys_id.",
    {
      table_name: z.string().describe("ServiceNow table name"),
      sys_id: z.string().describe("The 32-character sys_id of the record to delete"),
    },
    async ({ table_name, sys_id }) => {
      try {
        await client.deleteRecord(table_name, sys_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, message: `Record '${sys_id}' deleted from '${table_name}'.` }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error deleting record from '${table_name}': ${err.message}` }],
        };
      }
    }
  );
}
