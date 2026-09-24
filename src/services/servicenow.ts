import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { ServerConfig, config } from "../config.js";
import { OAuthTokenManager } from "./oauth.js";
import { ServiceNowResponse, TableQueryParams } from "../types.js";

export class ServiceNowClient {
  private config: ServerConfig;
  private oauthManager: OAuthTokenManager;
  private axiosInstance: AxiosInstance;

  constructor(customConfig?: ServerConfig) {
    this.config = customConfig || config;
    this.oauthManager = new OAuthTokenManager(this.config);
    this.axiosInstance = axios.create({
      baseURL: this.config.serviceNow.instanceUrl,
      timeout: 30000,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Generates authorization headers based on the configured auth type.
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const { authType, username, password } = this.config.serviceNow;

    if (authType === "basic") {
      if (!username || !password) {
        throw new Error("Basic Auth requires SERVICENOW_USERNAME and SERVICENOW_PASSWORD.");
      }
      const token = Buffer.from(`${username}:${password}`).toString("base64");
      return { Authorization: `Basic ${token}` };
    }

    // Default: OAuth 2.0
    const accessToken = await this.oauthManager.getAccessToken();
    return { Authorization: `Bearer ${accessToken}` };
  }

  /**
   * Wrapper for making authenticated HTTP requests with automatic 401 retry on OAuth.
   */
  private async request<T>(axiosConfig: AxiosRequestConfig, retryCount = 0): Promise<T> {
    try {
      const authHeaders = await this.getAuthHeaders();
      const headers = { ...axiosConfig.headers, ...authHeaders };

      const response: AxiosResponse<T> = await this.axiosInstance.request({
        ...axiosConfig,
        headers,
      });

      return response.data;
    } catch (err: any) {
      // Check for token expiration / 401 in OAuth mode: retry once with fresh token
      if (err.response?.status === 401 && this.config.serviceNow.authType === "oauth" && retryCount === 0) {
        this.oauthManager.clearToken();
        return this.request<T>(axiosConfig, retryCount + 1);
      }

      this.handleServiceNowError(err);
    }
  }

  /**
   * Translates ServiceNow API errors and HTTP failures into informative error messages.
   */
  private handleServiceNowError(err: any): never {
    if (!err.response) {
      if (err.code === "ECONNABORTED") {
        throw new Error(
          "ServiceNow request timed out. If you are using a ServiceNow PDI, it may be waking up or hibernating."
        );
      }
      throw new Error(`Failed to reach ServiceNow instance: ${err.message}`);
    }

    const status = err.response.status;
    const data = err.response.data;

    // Detect ServiceNow PDI hibernation (often 503 or HTML redirect page)
    if (status === 503 || (typeof data === "string" && data.includes("hibernating"))) {
      throw new Error(
        "ServiceNow PDI appears to be hibernating or offline. Please log into developer.servicenow.com to wake up your instance."
      );
    }

    if (data && typeof data === "object" && data.error) {
      const msg = data.error.message || "ServiceNow API error";
      const detail = data.error.detail ? ` Details: ${data.error.detail}` : "";
      throw new Error(`[ServiceNow HTTP ${status}] ${msg}.${detail}`);
    }

    throw new Error(`[ServiceNow HTTP ${status}] ${err.response.statusText || err.message}`);
  }

  /**
   * Query records from any ServiceNow table.
   */
  public async queryTable<T = any>(tableName: string, params: TableQueryParams = {}): Promise<T[]> {
    const queryParams: Record<string, any> = {
      sysparm_limit: params.sysparm_limit ?? 20,
      sysparm_display_value: params.sysparm_display_value ?? "all",
      sysparm_exclude_reference_link: params.sysparm_exclude_reference_link ?? true,
    };

    if (params.sysparm_query) {
      queryParams.sysparm_query = params.sysparm_query;
    }
    if (params.sysparm_offset !== undefined) {
      queryParams.sysparm_offset = params.sysparm_offset;
    }
    if (params.sysparm_fields) {
      queryParams.sysparm_fields = params.sysparm_fields;
    }

    const data = await this.request<ServiceNowResponse<T[]>>({
      method: "GET",
      url: `/api/now/table/${encodeURIComponent(tableName)}`,
      params: queryParams,
    });

    return data.result || [];
  }

  /**
   * Retrieve a single record from any table by sys_id.
   */
  public async getRecord<T = any>(
    tableName: string,
    sysId: string,
    fields?: string,
    displayValue: "true" | "false" | "all" = "all"
  ): Promise<T> {
    const params: Record<string, any> = {
      sysparm_display_value: displayValue,
      sysparm_exclude_reference_link: true,
    };
    if (fields) {
      params.sysparm_fields = fields;
    }

    const data = await this.request<ServiceNowResponse<T>>({
      method: "GET",
      url: `/api/now/table/${encodeURIComponent(tableName)}/${encodeURIComponent(sysId)}`,
      params,
    });

    return data.result;
  }

  /**
   * Insert a new record into any table.
   */
  public async createRecord<T = any>(tableName: string, recordData: Record<string, any>): Promise<T> {
    const data = await this.request<ServiceNowResponse<T>>({
      method: "POST",
      url: `/api/now/table/${encodeURIComponent(tableName)}`,
      data: recordData,
      params: {
        sysparm_display_value: "all",
      },
    });

    return data.result;
  }

  /**
   * Update an existing record in any table by sys_id.
   */
  public async updateRecord<T = any>(
    tableName: string,
    sysId: string,
    recordData: Record<string, any>
  ): Promise<T> {
    const data = await this.request<ServiceNowResponse<T>>({
      method: "PATCH",
      url: `/api/now/table/${encodeURIComponent(tableName)}/${encodeURIComponent(sysId)}`,
      data: recordData,
      params: {
        sysparm_display_value: "all",
      },
    });

    return data.result;
  }

  /**
   * Delete a record from any table by sys_id.
   */
  public async deleteRecord(tableName: string, sysId: string): Promise<boolean> {
    await this.request({
      method: "DELETE",
      url: `/api/now/table/${encodeURIComponent(tableName)}/${encodeURIComponent(sysId)}`,
    });
    return true;
  }

  /**
   * Health check / ping test. Queries 1 record from incident to confirm connectivity.
   */
  public async ping(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.queryTable("incident", { sysparm_limit: 1 });
      return { ok: true, message: "Successfully connected to ServiceNow instance and verified incident access." };
    } catch (err: any) {
      if (err.message && err.message.includes("Access to unscoped api is not allowed")) {
        return {
          ok: false,
          message:
            "OAuth Scope Restriction error: In ServiceNow PDI, go to 'System OAuth' -> 'Application Registry', open your record, change 'Scope Restriction' from 'Securely Scoped' to 'Broadly Scoped', and click Update.",
        };
      }
      return { ok: false, message: err.message };
    }
  }
}
