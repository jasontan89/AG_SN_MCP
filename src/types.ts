export interface ServiceNowResponse<T> {
  result: T;
}

export interface ServiceNowErrorResponse {
  error: {
    message: string;
    detail?: string;
  };
  status: string;
}

export interface ServiceNowOAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  expires_in: number;
}

export interface TableQueryParams {
  sysparm_query?: string;
  sysparm_limit?: number;
  sysparm_offset?: number;
  sysparm_fields?: string;
  sysparm_display_value?: "true" | "false" | "all";
  sysparm_exclude_reference_link?: boolean;
}

export interface GenericRecord {
  sys_id: string;
  [key: string]: any;
}
