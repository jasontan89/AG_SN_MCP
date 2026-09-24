import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ServiceNowClient } from "../services/servicenow.js";

async function resolveRecordTableAndSysId(
  client: ServiceNowClient,
  recordIdentifier: string,
  explicitTable?: string
): Promise<{ tableName: string; sysId: string }> {
  const trimmed = recordIdentifier.trim();

  // If explicit table is provided
  if (explicitTable) {
    if (/^[0-9a-f]{32}$/i.test(trimmed)) {
      return { tableName: explicitTable, sysId: trimmed };
    }
    // Search by number in the explicit table
    const results = await client.queryTable(explicitTable, {
      sysparm_query: `number=${trimmed}`,
      sysparm_limit: 1,
      sysparm_display_value: "false",
    });
    if (!results || results.length === 0) {
      throw new Error(`Record with number '${trimmed}' not found in table '${explicitTable}'.`);
    }
    return { tableName: explicitTable, sysId: results[0].sys_id };
  }

  // If it's already a 32-character sys_id without table, table is required
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    throw new Error(
      `When providing a 32-character sys_id ('${trimmed}'), 'table_name' is required to locate the attachment.`
    );
  }

  // Auto-detect table by ticket prefix
  let guessedTable: string | null = null;
  const upper = trimmed.toUpperCase();
  if (upper.startsWith("INC")) guessedTable = "incident";
  else if (upper.startsWith("CHG")) guessedTable = "change_request";
  else if (upper.startsWith("PRB")) guessedTable = "problem";
  else if (upper.startsWith("KB")) guessedTable = "kb_knowledge";
  else if (upper.startsWith("RITM")) guessedTable = "sc_req_item";
  else if (upper.startsWith("REQ")) guessedTable = "sc_request";
  else if (upper.startsWith("SCTASK") || upper.startsWith("TASK")) guessedTable = "sc_task";

  if (!guessedTable) {
    throw new Error(
      `Could not auto-determine table from record identifier '${trimmed}'. Please provide 'table_name' explicitly.`
    );
  }

  const results = await client.queryTable(guessedTable, {
    sysparm_query: `number=${trimmed}`,
    sysparm_limit: 1,
    sysparm_display_value: "false",
  });
  if (!results || results.length === 0) {
    throw new Error(`Record '${trimmed}' not found in table '${guessedTable}'.`);
  }
  return { tableName: guessedTable, sysId: results[0].sys_id };
}

function isTextMime(contentType: string, fileName: string): boolean {
  const lower = contentType.toLowerCase();
  if (
    lower.startsWith("text/") ||
    lower.includes("json") ||
    lower.includes("xml") ||
    lower.includes("javascript") ||
    lower.includes("csv") ||
    lower.includes("yaml") ||
    lower.includes("markdown")
  ) {
    return true;
  }
  const ext = fileName.split(".").pop()?.toLowerCase();
  const textExts = ["txt", "log", "json", "xml", "csv", "yml", "yaml", "md", "js", "ts", "py", "sh", "bat", "ps1", "sql", "html", "css"];
  if (ext && textExts.includes(ext)) {
    return true;
  }
  return false;
}

function inferMimeType(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "txt":
    case "log":
      return "text/plain";
    case "json":
      return "application/json";
    case "xml":
      return "application/xml";
    case "csv":
      return "text/csv";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "zip":
      return "application/zip";
    case "tar":
    case "gz":
      return "application/gzip";
    default:
      return "application/octet-stream";
  }
}

export function registerAttachmentTools(server: McpServer, client: ServiceNowClient) {
  server.tool(
    "sn_list_attachments",
    "List all file attachments linked to a ServiceNow record (incident, change, problem, etc.).",
    {
      record_identifier: z
        .string()
        .describe("Record number (e.g., 'INC0010006', 'CHG0030002', 'PRB0040001') or 32-character sys_id"),
      table_name: z
        .string()
        .optional()
        .describe("ServiceNow table name (optional if record_identifier starts with INC, CHG, PRB, KB, RITM, or REQ)"),
    },
    async ({ record_identifier, table_name }) => {
      try {
        const { tableName, sysId } = await resolveRecordTableAndSysId(client, record_identifier, table_name);
        const attachments = await client.listAttachments(tableName, sysId);

        const summary = attachments.map((att) => ({
          sys_id: att.sys_id,
          file_name: att.file_name,
          content_type: att.content_type,
          size_bytes: parseInt(att.size_bytes || "0", 10),
          size_formatted: `${(parseInt(att.size_bytes || "0", 10) / 1024).toFixed(1)} KB`,
          created_on: att.sys_created_on,
          created_by: att.sys_created_by,
          table_name: att.table_name,
          table_sys_id: att.table_sys_id,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  record: record_identifier,
                  table_name: tableName,
                  record_sys_id: sysId,
                  total_attachments: summary.length,
                  attachments: summary,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error listing attachments for '${record_identifier}': ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_download_attachment",
    "Download the contents of an attachment from ServiceNow. Auto-decodes UTF-8 text for text/logs, or returns base64 for images/binaries.",
    {
      attachment_sys_id: z.string().describe("The 32-character sys_id of the attachment (obtained via sn_list_attachments)"),
      encoding: z
        .enum(["auto", "utf-8", "base64"])
        .default("auto")
        .describe("Return format: 'auto' (smart detect text vs binary), 'utf-8', or 'base64'"),
    },
    async ({ attachment_sys_id, encoding }) => {
      try {
        const { data, contentType, fileName } = await client.downloadAttachment(attachment_sys_id);

        let isText = false;
        if (encoding === "utf-8") {
          isText = true;
        } else if (encoding === "base64") {
          isText = false;
        } else {
          isText = isTextMime(contentType, fileName);
        }

        if (isText) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    attachment_sys_id,
                    file_name: fileName,
                    content_type: contentType,
                    size_bytes: data.length,
                    encoding: "utf-8",
                    content: data.toString("utf-8"),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    attachment_sys_id,
                    file_name: fileName,
                    content_type: contentType,
                    size_bytes: data.length,
                    encoding: "base64",
                    content_base64: data.toString("base64"),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error downloading attachment '${attachment_sys_id}': ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    "sn_upload_attachment",
    "Upload and attach a file (log, diagnostics, screenshot, config dump) to a ServiceNow ticket.",
    {
      record_identifier: z
        .string()
        .describe("Record number (e.g. 'INC0010006', 'CHG0030002', 'PRB0040001') or 32-character sys_id"),
      file_name: z
        .string()
        .describe("Name of the file including extension (e.g. 'diagnostics.log', 'memory_dump.json', 'screenshot.png')"),
      content: z.string().describe("Content of the file as plain text OR as a base64-encoded string"),
      is_base64: z
        .boolean()
        .default(false)
        .describe("Set to true if 'content' is base64-encoded binary data (images, archives, PDFs)"),
      content_type: z
        .string()
        .optional()
        .describe("Optional MIME type. If omitted, will be automatically inferred from file extension."),
      table_name: z
        .string()
        .optional()
        .describe("Optional table name override (required if using raw 32-character sys_id)"),
    },
    async ({ record_identifier, file_name, content, is_base64 = false, content_type, table_name }) => {
      try {
        const { tableName, sysId } = await resolveRecordTableAndSysId(client, record_identifier, table_name);

        const mime = content_type || inferMimeType(file_name);
        const buffer = is_base64 ? Buffer.from(content, "base64") : Buffer.from(content, "utf-8");

        const result = await client.uploadAttachment(tableName, sysId, file_name, buffer, mime);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: `File '${file_name}' attached successfully to ${tableName} (${record_identifier}).`,
                  attachment: result,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            { type: "text", text: `Error uploading attachment '${file_name}' to '${record_identifier}': ${err.message}` },
          ],
        };
      }
    }
  );

  server.tool(
    "sn_delete_attachment",
    "Delete an attachment from ServiceNow by its attachment sys_id.",
    {
      attachment_sys_id: z.string().describe("The 32-character sys_id of the attachment to delete"),
    },
    async ({ attachment_sys_id }) => {
      try {
        await client.deleteAttachment(attachment_sys_id);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: `Attachment '${attachment_sys_id}' deleted successfully.`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error deleting attachment '${attachment_sys_id}': ${err.message}` }],
        };
      }
    }
  );
}
