export type MCPServerConfig = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
};

export type MCPToolSpec = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
};

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string; result: unknown }
  | { jsonrpc: "2.0"; id: number | string; error: { code: number; message: string; data?: unknown } };
