import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type {
  AdapterContext,
  ConnectorCall,
  ConnectorEvent,
  ConnectorProvider,
  ConnectorTool,
} from "@rakazo/adapter-kit";
import { spawn } from "node:child_process";

export interface McpServerConfig {
  name: string;
  type: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpClientConfig {
  servers: McpServerConfig[];
}

interface McpClientConnection {
  client: Client;
  transport: StdioClientTransport | SSEClientTransport;
  serverName: string;
}

export class McpClient implements ConnectorProvider {
  private connections = new Map<string, McpClientConnection>();
  private initPromise: Promise<void> | undefined;
  private readonly config: McpClientConfig;

  constructor(config: McpClientConfig) {
    this.config = config;
  }

  describe() {
    return {
      id: "mcp-client",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: false, secretsBrokered: false },
    };
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const initPromises = this.config.servers.map(async (serverConfig) => {
      try {
        await this.connectServer(serverConfig);
      } catch (error) {
        console.error(
          `[MCP] Failed to connect to server ${serverConfig.name}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    });
    await Promise.all(initPromises);
  }

  private async connectServer(config: McpServerConfig): Promise<void> {
    if (this.connections.has(config.name)) {
      return;
    }

    const connectionTimeout = 10000;
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Connection timeout")), connectionTimeout),
    );

    const connectPromise = (async () => {
      let transport: StdioClientTransport | SSEClientTransport;
      if (config.type === "stdio") {
        if (!config.command) {
          throw new Error(`MCP server ${config.name} requires a command for stdio transport`);
        }
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries({ ...process.env, ...config.env })) {
          if (value !== undefined) {
            env[key] = value;
          }
        }
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env,
        });
      } else if (config.type === "sse") {
        if (!config.url) {
          throw new Error(`MCP server ${config.name} requires a url for sse transport`);
        }
        transport = new SSEClientTransport(new URL(config.url));
      } else {
        throw new Error(`Unsupported MCP transport type: ${config.type}`);
      }

      const client = new Client(
        {
          name: "rakazo-mcp-client",
          version: "0.1.0",
        },
        {
          capabilities: {},
        },
      );

      await client.connect(transport);
      return { client, transport, serverName: config.name };
    })();

    const connection = await Promise.race([connectPromise, timeoutPromise]);
    this.connections.set(config.name, connection);
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    await this.initialize();
    const allTools: ConnectorTool[] = [];

    for (const [serverName, connection] of this.connections.entries()) {
      try {
        const { tools } = await connection.client.listTools();
        for (const tool of tools) {
          allTools.push({
            name: `${serverName}.${tool.name}`,
            description: tool.description ?? tool.name,
            inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {
              type: "object",
              properties: {},
            },
          });
        }
      } catch (error) {
        console.error(
          `[MCP] Failed to list tools from ${serverName}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return allTools;
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    await this.initialize();

    const [serverName, ...toolNameParts] = call.tool.split(".");
    const toolName = toolNameParts.join(".");

    if (!serverName || !toolName) {
      yield { type: "error", message: `Invalid MCP tool name: ${call.tool}` };
      return;
    }

    const connection = this.connections.get(serverName);
    if (!connection) {
      yield {
        type: "error",
        message: `MCP server ${serverName} not found or not connected`,
      };
      return;
    }

    try {
      const result = await connection.client.callTool({
        name: toolName,
        arguments: call.args ?? {},
      });

      if (result.isError) {
        const errorMsg =
          Array.isArray(result.content) && result.content.length > 0
            ? String(
                (result.content[0] as { text?: string; type?: string }).text ?? "Unknown error",
              )
            : "Unknown error";
        yield {
          type: "error",
          message: `MCP tool error: ${errorMsg}`,
        };
        return;
      }

      const textContent = Array.isArray(result.content)
        ? result.content
            .filter((c: { type?: string }) => c.type === "text")
            .map((c: { text?: string }) => c.text ?? "")
            .join("\n")
        : "";

      yield {
        type: "result",
        data: {
          content: textContent || "ok",
          raw: result.content,
        },
      };
    } catch (error) {
      yield {
        type: "error",
        message: `MCP execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async close(): Promise<void> {
    const closePromises = Array.from(this.connections.values()).map(async ({ client }) => {
      try {
        await client.close();
      } catch (error) {
        console.error("[MCP] Error closing client:", error);
      }
    });
    await Promise.all(closePromises);
    this.connections.clear();
    this.initPromise = undefined;
  }
}

export function parseMcpConfig(envVars: Record<string, string | undefined>): McpClientConfig {
  const servers: McpServerConfig[] = [];

  const mcpConfigPath = envVars.MCP_CONFIG_PATH;
  if (mcpConfigPath) {
    try {
      const fs = require("node:fs");
      const configContent = fs.readFileSync(mcpConfigPath, "utf-8");
      const config = JSON.parse(configContent);
      if (config.mcpServers && Array.isArray(config.mcpServers)) {
        servers.push(...config.mcpServers);
      }
    } catch (error) {
      console.error(
        `[MCP] Failed to load config from ${mcpConfigPath}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const mcpServersEnv = envVars.MCP_SERVERS;
  if (mcpServersEnv) {
    try {
      const envServers = JSON.parse(mcpServersEnv);
      if (Array.isArray(envServers)) {
        servers.push(...envServers);
      }
    } catch (error) {
      console.error(
        "[MCP] Failed to parse MCP_SERVERS env var:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { servers };
}

export function isMcpEnabled(config: McpClientConfig): boolean {
  return config.servers.length > 0;
}
