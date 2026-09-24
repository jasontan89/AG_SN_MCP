import axios from "axios";
import { ServerConfig } from "../config.js";
import { ServiceNowOAuthTokenResponse } from "../types.js";

export class OAuthTokenManager {
  private config: ServerConfig;
  private cachedToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private inFlightTokenPromise: Promise<string> | null = null;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  /**
   * Clears any cached token, forcing the next call to re-authenticate.
   */
  public clearToken(): void {
    this.cachedToken = null;
    this.tokenExpiresAt = null;
    this.inFlightTokenPromise = null;
  }

  /**
   * Retrieves a valid Bearer token, reusing the cached token if not yet expired.
   */
  public async getAccessToken(): Promise<string> {
    const now = Date.now();
    // Re-use cached token if it has at least 60 seconds left before expiration
    if (this.cachedToken && this.tokenExpiresAt && now < this.tokenExpiresAt - 60000) {
      return this.cachedToken;
    }

    // Deduplicate concurrent token requests
    if (this.inFlightTokenPromise) {
      return this.inFlightTokenPromise;
    }

    this.inFlightTokenPromise = this.fetchNewToken()
      .then((token) => {
        this.inFlightTokenPromise = null;
        return token;
      })
      .catch((err) => {
        this.inFlightTokenPromise = null;
        throw err;
      });

    return this.inFlightTokenPromise;
  }

  private async fetchNewToken(): Promise<string> {
    const { instanceUrl, clientId, clientSecret, oauthGrantType, username, password } = this.config.serviceNow;

    if (!instanceUrl) {
      throw new Error("ServiceNow instance URL is not configured (SERVICENOW_INSTANCE_URL).");
    }
    if (!clientId || !clientSecret) {
      throw new Error(
        "OAuth credentials missing: SERVICENOW_CLIENT_ID and SERVICENOW_CLIENT_SECRET are required."
      );
    }

    const tokenUrl = `${instanceUrl}/oauth_token.do`;
    const params = new URLSearchParams();

    if (oauthGrantType === "password") {
      if (!username || !password) {
        throw new Error(
          "Password grant requires SERVICENOW_USERNAME and SERVICENOW_PASSWORD to be configured."
        );
      }
      params.append("grant_type", "password");
      params.append("client_id", clientId);
      params.append("client_secret", clientSecret);
      params.append("username", username);
      params.append("password", password);
    } else {
      // client_credentials grant
      params.append("grant_type", "client_credentials");
      params.append("client_id", clientId);
      params.append("client_secret", clientSecret);
    }

    try {
      const response = await axios.post<ServiceNowOAuthTokenResponse>(tokenUrl, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        timeout: 15000,
      });

      const { access_token, expires_in } = response.data;
      if (!access_token) {
        throw new Error("No access_token returned by ServiceNow OAuth endpoint.");
      }

      this.cachedToken = access_token;
      // expires_in is in seconds (e.g. 1800s = 30min)
      const ttlMs = (expires_in || 1800) * 1000;
      this.tokenExpiresAt = Date.now() + ttlMs;

      return access_token;
    } catch (err: any) {
      const errorMsg =
        err.response?.data?.error_description ||
        err.response?.data?.error ||
        err.message ||
        "Unknown error";
      const status = err.response?.status ? `HTTP ${err.response.status}` : "Network Error";

      throw new Error(
        `ServiceNow OAuth token generation failed (${status}): ${errorMsg}. ` +
          `Check your Instance URL, Client ID, Client Secret, and ensure the OAuth Application Registry entry in ServiceNow is Active.`
      );
    }
  }
}
