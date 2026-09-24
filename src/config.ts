import dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

export interface ServerConfig {
  port: number;
  mcpApiKey: string;
  serviceNow: {
    instanceUrl: string;
    authType: "oauth" | "basic";
    clientId?: string;
    clientSecret?: string;
    oauthGrantType: "client_credentials" | "password";
    username?: string;
    password?: string;
  };
}

function cleanUrl(url: string | undefined): string {
  if (!url) return "";
  // Strip trailing slashes
  return url.trim().replace(/\/+$/, "");
}

export function loadConfig(): ServerConfig {
  const port = parseInt(process.env.PORT || "3000", 10);
  const mcpApiKey = process.env.MCP_API_KEY || "";
  const rawInstanceUrl = process.env.SERVICENOW_INSTANCE_URL || "";
  const instanceUrl = cleanUrl(rawInstanceUrl);
  const authType = (process.env.SERVICENOW_AUTH_TYPE?.toLowerCase() === "basic" ? "basic" : "oauth") as "oauth" | "basic";
  const clientId = process.env.SERVICENOW_CLIENT_ID || "";
  const clientSecret = process.env.SERVICENOW_CLIENT_SECRET || "";
  const oauthGrantType = (process.env.SERVICENOW_OAUTH_GRANT_TYPE?.toLowerCase() === "password" ? "password" : "client_credentials") as "client_credentials" | "password";
  const username = process.env.SERVICENOW_USERNAME || "";
  const password = process.env.SERVICENOW_PASSWORD || "";

  return {
    port: isNaN(port) ? 3000 : port,
    mcpApiKey,
    serviceNow: {
      instanceUrl,
      authType,
      clientId,
      clientSecret,
      oauthGrantType,
      username,
      password,
    },
  };
}

export const config = loadConfig();
