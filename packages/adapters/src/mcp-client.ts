import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  AdapterContext,
  ConnectorCall,
  ConnectorEvent,
  ConnectorProvider,
  ConnectorTool,
} from "@rakazo/adapter-kit";

export interface McpServerConfig {
  name: string;
  type: "stdio" | "sse" | "http";
  disabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpClientConfig {
  servers: McpServerConfig[];
}

export interface McpServerStatus {
  name: string;
  status: "connected" | "error" | "disabled";
  toolCount: number;
  error?: string;
}

export interface McpServerPublic {
  name: string;
  type: McpServerConfig["type"];
  command?: string;
  args?: string[];
  url?: string;
  disabled?: boolean;
  hasHeaders: boolean;
  hasEnv: boolean;
}

type McpTransport = StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

interface McpClientConnection {
  client: Client;
  transport: McpTransport;
  serverName: string;
  status: "connected" | "error";
  toolCount?: number;
  error?: string;
}

const CONNECTION_TIMEOUT_MS = 15_000;

/** Env vars a stdio MCP child may inherit. Secrets stay out. */
const STDIO_ENV_ALLOWLIST = new Set([
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TMP",
  "TEMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "SYSTEMROOT",
  "SystemRoot",
  "COMSPEC",
  "ComSpec",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "APPDATA",
  "LOCALAPPDATA",
]);

export type McpConfigSource = () => Promise<McpClientConfig> | McpClientConfig;

export class McpClient implements ConnectorProvider {
  private connections = new Map<string, McpClientConnection>();
  private initPromise: Promise<void> | undefined;
  private gate: Promise<void> = Promise.resolve();
  private config: McpClientConfig;
  private readonly source?: McpConfigSource;
  private fingerprint: string;
  private connectionErrors = new Map<string, string>();
  private closed = false;

  constructor(config: McpClientConfig, source?: McpConfigSource) {
    this.config = config;
    this.source = source;
    this.fingerprint = configFingerprint(config);
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
    return this.serialize(async () => {
      if (this.closed) return;
      await this.refreshIfStale();
      if (this.closed) return;
      if (!this.initPromise) this.initPromise = this.doInitialize();
      await this.initPromise;
    });
  }

  async reload(config: McpClientConfig): Promise<void> {
    return this.serialize(async () => {
      this.closed = false;
      await this.closeUnlocked();
      this.config = config;
      this.fingerprint = configFingerprint(config);
      this.connectionErrors.clear();
      this.initPromise = this.doInitialize();
      await this.initPromise;
    });
  }

  private serialize(work: () => Promise<void>): Promise<void> {
    const run = this.gate.then(work, work);
    this.gate = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async refreshIfStale(): Promise<void> {
    if (!this.source) return;
    let next: McpClientConfig;
    try {
      next = await this.source();
    } catch {
      return;
    }
    if (configFingerprint(next) === this.fingerprint) return;
    await this.closeUnlocked();
    this.config = next;
    this.fingerprint = configFingerprint(next);
    this.connectionErrors.clear();
  }

  private async doInitialize(): Promise<void> {
    const initPromises = this.config.servers.map(async (serverConfig) => {
      if (serverConfig.disabled) return;
      try {
        await this.connectServer(serverConfig);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.connectionErrors.set(serverConfig.name, errorMsg);
        console.error(`[MCP] Failed to connect to server ${serverConfig.name}:`, errorMsg);
      }
    });
    await Promise.all(initPromises);
  }

  private async connectServer(config: McpServerConfig): Promise<void> {
    if (this.connections.has(config.name)) return;

    const transport = createTransport(config);
    const client = new Client(
      { name: "rakazo-mcp-client", version: "0.1.0" },
      { capabilities: {} },
    );
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            void client.close().catch(() => undefined);
            reject(new Error("Connection timeout"));
          }, CONNECTION_TIMEOUT_MS);
        }),
      ]);
      this.connections.set(config.name, {
        client,
        transport,
        serverName: config.name,
        status: "connected",
      });
      this.connectionErrors.delete(config.name);
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async discoverTools(_context: AdapterContext): Promise<ConnectorTool[]> {
    await this.initialize();
    const allTools: ConnectorTool[] = [];

    for (const [serverName, connection] of this.connections.entries()) {
      try {
        const { tools } = await connection.client.listTools();
        connection.toolCount = tools.length;
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
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[MCP] Failed to list tools from ${serverName}:`, message);
        connection.status = "error";
        connection.error = message;
      }
    }

    return allTools;
  }

  ownsTool(tool: string): boolean {
    return Boolean(matchMcpServer(this.config.servers, tool, { includeDisabled: false }));
  }

  async getServerStatus(): Promise<McpServerStatus[]> {
    await this.initialize();
    return this.config.servers.map((server) => {
      if (server.disabled) {
        return { name: server.name, status: "disabled" as const, toolCount: 0 };
      }
      const connection = this.connections.get(server.name);
      const error = this.connectionErrors.get(server.name);
      if (connection) {
        return {
          name: server.name,
          status: connection.status,
          toolCount: connection.toolCount ?? 0,
          error: connection.error,
        };
      }
      return {
        name: server.name,
        status: "error" as const,
        toolCount: 0,
        error: error ?? "Not connected",
      };
    });
  }

  async *execute(call: ConnectorCall, _context: AdapterContext): AsyncIterable<ConnectorEvent> {
    await this.initialize();

    const matched = matchMcpServer(this.config.servers, call.tool, { includeDisabled: true });
    const toolName = matched ? call.tool.slice(matched.name.length + 1) : "";

    if (!matched) {
      const guess = call.tool.includes(".") ? call.tool.slice(0, call.tool.indexOf(".")) : "";
      yield {
        type: "error",
        message: guess
          ? `MCP server ${guess} not found or not connected`
          : `Invalid MCP tool name: ${call.tool}`,
      };
      return;
    }
    if (matched.disabled || !toolName) {
      yield {
        type: "error",
        message: toolName
          ? `MCP server ${matched.name} not found or not connected`
          : `Invalid MCP tool name: ${call.tool}`,
      };
      return;
    }

    const connection = this.connections.get(matched.name);
    if (!connection) {
      yield {
        type: "error",
        message: `MCP server ${matched.name} not found or not connected`,
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
            ? String((result.content[0] as { text?: string }).text ?? "Unknown error")
            : "Unknown error";
        yield { type: "error", message: `MCP tool error: ${errorMsg}` };
        return;
      }

      const textContent = Array.isArray(result.content)
        ? result.content
            .filter((part: { type?: string }) => part.type === "text")
            .map((part: { text?: string }) => part.text ?? "")
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
    return this.serialize(async () => {
      this.closed = true;
      await this.closeUnlocked();
    });
  }

  private async closeUnlocked(): Promise<void> {
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

export type McpConfigStore = {
  deploymentSettings: {
    findUnique: (args: { where: { id: string } }) => Promise<{ mcpServers?: string | null } | null>;
  };
};

export function parseMcpConfig(
  envVars: Record<string, string | undefined>,
  prisma?: McpConfigStore,
): McpClientConfig | Promise<McpClientConfig> {
  if (prisma) return parseMcpConfigAsync(envVars, prisma);
  return parseMcpConfigFromEnv(envVars);
}

export function parseMcpConfigFromEnv(
  envVars: Record<string, string | undefined>,
): McpClientConfig {
  return {
    servers: dedupeServers([
      ...serversFromConfigPath(envVars.MCP_CONFIG_PATH),
      ...serversFromEnvJson(envVars.MCP_SERVERS),
    ]),
  };
}

async function parseMcpConfigAsync(
  envVars: Record<string, string | undefined>,
  prisma: McpConfigStore,
): Promise<McpClientConfig> {
  const servers = [
    ...serversFromConfigPath(envVars.MCP_CONFIG_PATH),
    ...serversFromEnvJson(envVars.MCP_SERVERS),
  ];

  try {
    const settings = await prisma.deploymentSettings.findUnique({
      where: { id: "default" },
    });
    if (settings?.mcpServers) {
      servers.push(...normalizeMcpServers(JSON.parse(settings.mcpServers)));
    }
  } catch (error) {
    console.error(
      "[MCP] Failed to load servers from database:",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }

  return { servers: dedupeServers(servers) };
}

export function matchMcpServer(
  servers: readonly McpServerConfig[],
  tool: string,
  opts?: { includeDisabled?: boolean },
): McpServerConfig | undefined {
  let best: McpServerConfig | undefined;
  for (const server of servers) {
    if (!opts?.includeDisabled && server.disabled) continue;
    if (tool === server.name || tool.startsWith(`${server.name}.`)) {
      if (!best || server.name.length > best.name.length) best = server;
    }
  }
  return best;
}

export function isMcpEnabled(config: McpClientConfig): boolean {
  return config.servers.some((server) => !server.disabled);
}

export function toPublicMcpServer(server: McpServerConfig): McpServerPublic {
  return {
    name: server.name,
    type: server.type,
    command: server.command,
    args: server.args,
    url: server.url,
    disabled: server.disabled,
    hasHeaders: Boolean(server.headers && Object.keys(server.headers).length > 0),
    hasEnv: Boolean(server.env && Object.keys(server.env).length > 0),
  };
}

export function mergeMcpServerSecrets(
  incoming: McpServerConfig[],
  existing: McpServerConfig[],
): McpServerConfig[] {
  const previous = new Map(existing.map((server) => [server.name, server]));
  const removed = existing.filter((server) => !incoming.some((next) => next.name === server.name));
  const added = incoming.filter((server) => !existing.some((prior) => prior.name === server.name));
  if (removed.length === 1 && added.length === 1 && removed[0] && added[0]) {
    previous.set(added[0].name, removed[0]);
  }
  return incoming.map((server) => {
    const prior = previous.get(server.name);
    return {
      ...server,
      headers: server.headers ?? prior?.headers,
      env: server.env ?? prior?.env,
    };
  });
}

export function normalizeMcpServers(raw: unknown): McpServerConfig[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => {
      const parsed = parseServerEntry(entry);
      return parsed ? [parsed] : [];
    });
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>).flatMap(([name, spec]) => {
      if (!spec || typeof spec !== "object") return [];
      const parsed = parseServerEntry({ name, ...(spec as Record<string, unknown>) });
      return parsed ? [parsed] : [];
    });
  }
  return [];
}

export function stdioChildEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && STDIO_ENV_ALLOWLIST.has(key)) env[key] = value;
  }
  if (extra) Object.assign(env, extra);
  return env;
}

function parseServerEntry(entry: unknown): McpServerConfig | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const raw = entry as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return undefined;

  const command = typeof raw.command === "string" ? raw.command : undefined;
  const url = typeof raw.url === "string" ? raw.url : undefined;
  const declared = raw.type;
  const type: McpServerConfig["type"] =
    declared === "stdio" || declared === "sse" || declared === "http"
      ? declared
      : command
        ? "stdio"
        : "http";

  return {
    name,
    type,
    disabled: raw.disabled === true,
    command,
    args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
    env: isStringRecord(raw.env) ? raw.env : undefined,
    url,
    headers: isStringRecord(raw.headers) ? raw.headers : undefined,
  };
}

function serversFromConfigPath(path: string | undefined): McpServerConfig[] {
  if (!path) return [];
  try {
    const config = JSON.parse(readFileSync(path, "utf-8")) as { mcpServers?: unknown };
    return normalizeMcpServers(config.mcpServers ?? config);
  } catch (error) {
    console.error(
      `[MCP] Failed to load config from ${path}:`,
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

function serversFromEnvJson(value: string | undefined): McpServerConfig[] {
  if (!value) return [];
  try {
    return normalizeMcpServers(JSON.parse(value));
  } catch (error) {
    console.error(
      "[MCP] Failed to parse MCP_SERVERS env var:",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

function dedupeServers(servers: McpServerConfig[]): McpServerConfig[] {
  const seen = new Set<string>();
  const result: McpServerConfig[] = [];
  for (const server of servers) {
    if (seen.has(server.name)) continue;
    seen.add(server.name);
    result.push(server);
  }
  return result;
}

function createTransport(config: McpServerConfig): McpTransport {
  if (config.type === "stdio") {
    if (!config.command) {
      throw new Error(`MCP server ${config.name} requires a command for stdio transport`);
    }
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: stdioChildEnv(config.env),
    });
  }
  if (!config.url) {
    throw new Error(`MCP server ${config.name} requires a url for ${config.type} transport`);
  }
  const requestInit = config.headers ? { headers: config.headers } : undefined;
  if (config.type === "http") {
    return new StreamableHTTPClientTransport(new URL(config.url), { requestInit });
  }
  if (config.type === "sse") {
    return new SSEClientTransport(new URL(config.url), requestInit ? { requestInit } : undefined);
  }
  throw new Error(`Unsupported MCP transport type: ${String(config.type)}`);
}

function configFingerprint(config: McpClientConfig): string {
  return JSON.stringify(
    config.servers.map((server) => ({
      name: server.name,
      type: server.type,
      disabled: Boolean(server.disabled),
      command: server.command ?? "",
      args: server.args ?? [],
      url: server.url ?? "",
      env: server.env ?? {},
      headers: server.headers ?? {},
    })),
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}
