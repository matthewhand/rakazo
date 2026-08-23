import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  McpClient,
  parseMcpConfig,
  parseMcpConfigFromEnv,
  isMcpEnabled,
  type McpClientConfig,
} from "./mcp-client.js";
import { McpEmulator } from "./mcp-emulator.js";
import type { AdapterContext } from "@rakazo/adapter-kit";

describe("McpClient", () => {
  let emulator: McpEmulator;
  let port: number;
  let client: McpClient | undefined;

  const mockContext: AdapterContext = {
    operationId: "test-op",
    traceId: "test-trace",
    workspaceId: "test-workspace",
    userId: "test-user",
    signal: new AbortController().signal,
  };

  beforeEach(async () => {
    emulator = new McpEmulator();
    port = await emulator.start();
  });

  afterEach(async () => {
    await client?.close();
    await emulator.stop();
  });

  it("should describe itself correctly", () => {
    const config: McpClientConfig = { servers: [] };
    client = new McpClient(config);
    const desc = client.describe();
    expect(desc.id).toBe("mcp-client");
    expect(desc.capabilities.discover).toBe(true);
    expect(desc.capabilities.oauth).toBe(false);
  });

  it("should discover tools from HTTP MCP server", async () => {
    const config: McpClientConfig = {
      servers: [
        {
          name: "test-notes",
          type: "sse",
          url: `http://127.0.0.1:${port}`,
        },
      ],
    };
    client = new McpClient(config);
    const tools = await client.discoverTools(mockContext);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("test-notes.notes.write");
    expect(tools[0]?.description).toContain("note");
  });

  it("should execute tool on HTTP MCP server", async () => {
    const config: McpClientConfig = {
      servers: [
        {
          name: "test-notes",
          type: "sse",
          url: `http://127.0.0.1:${port}`,
        },
      ],
    };
    client = new McpClient(config);
    await client.initialize();

    const events: string[] = [];
    for await (const event of client.execute(
      {
        tool: "test-notes.notes.write",
        args: { path: "hello.md", text: "Hello world" },
        executionId: "test-exec-1",
      },
      mockContext,
    )) {
      events.push(event.type);
      if (event.type === "result") {
        expect(event.data).toHaveProperty("content");
      }
    }
    expect(events).toContain("result");
    expect(emulator.writes).toHaveLength(1);
    expect(emulator.writes[0]?.path).toBe("hello.md");
    expect(emulator.writes[0]?.text).toBe("Hello world");
  });

  it("should handle invalid tool name", async () => {
    const config: McpClientConfig = {
      servers: [
        {
          name: "test-notes",
          type: "sse",
          url: `http://127.0.0.1:${port}`,
        },
      ],
    };
    client = new McpClient(config);
    await client.initialize();

    const events: string[] = [];
    for await (const event of client.execute(
      {
        tool: "invalid",
        args: {},
        executionId: "test-exec-2",
      },
      mockContext,
    )) {
      events.push(event.type);
      if (event.type === "error") {
        expect(event.message).toContain("Invalid MCP tool name");
      }
    }
    expect(events).toContain("error");
  });

  it("should handle missing server", async () => {
    const config: McpClientConfig = { servers: [] };
    client = new McpClient(config);
    await client.initialize();

    const events: string[] = [];
    for await (const event of client.execute(
      {
        tool: "missing-server.tool",
        args: {},
        executionId: "test-exec-3",
      },
      mockContext,
    )) {
      events.push(event.type);
      if (event.type === "error") {
        expect(event.message).toContain("not found");
      }
    }
    expect(events).toContain("error");
  });

  it("should namespace tools by server name", async () => {
    const config: McpClientConfig = {
      servers: [
        {
          name: "server-a",
          type: "sse",
          url: `http://127.0.0.1:${port}`,
        },
      ],
    };
    client = new McpClient(config);
    const tools = await client.discoverTools(mockContext);
    expect(tools[0]?.name).toContain("server-a.");
  });
});

describe("parseMcpConfig", () => {
  it("should parse MCP_SERVERS from env", () => {
    const envVars = {
      MCP_SERVERS: JSON.stringify([
        {
          name: "test",
          type: "stdio",
          command: "node",
          args: ["server.js"],
        },
      ]),
    };
    const config = parseMcpConfigFromEnv(envVars);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0]?.name).toBe("test");
    expect(config.servers[0]?.type).toBe("stdio");
  });

  it("should return empty config when no env vars set", () => {
    const config = parseMcpConfigFromEnv({});
    expect(config.servers).toHaveLength(0);
  });

  it("should handle malformed JSON in MCP_SERVERS", () => {
    const config = parseMcpConfigFromEnv({ MCP_SERVERS: "not json" });
    expect(config.servers).toHaveLength(0);
  });

  it("should load servers from database when prisma is provided", async () => {
    const mockPrisma = {
      deploymentSettings: {
        findUnique: async () => ({
          mcpServers: JSON.stringify([
            { name: "db-server", type: "http", url: "http://db:3000" },
          ]),
        }),
      },
    };

    const config = await parseMcpConfig({}, mockPrisma as never);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0]?.name).toBe("db-server");
  });

  it("keeps disabled servers in the parsed config", async () => {
    const mockPrisma = {
      deploymentSettings: {
        findUnique: async () => ({
          mcpServers: JSON.stringify([
            { name: "enabled", type: "http", url: "http://enabled:3000" },
            { name: "disabled", type: "http", url: "http://disabled:3000", disabled: true },
          ]),
        }),
      },
    };

    const config = await parseMcpConfig({}, mockPrisma as never);
    expect(config.servers.map((server) => server.name)).toEqual(["enabled", "disabled"]);
    expect(config.servers[1]?.disabled).toBe(true);
  });

  it("should merge env and database servers", async () => {
    const mockPrisma = {
      deploymentSettings: {
        findUnique: async () => ({
          mcpServers: JSON.stringify([
            { name: "db-server", type: "http", url: "http://db:3000" },
          ]),
        }),
      },
    };

    const config = await parseMcpConfig(
      {
        MCP_SERVERS: JSON.stringify([
          { name: "env-server", type: "http", url: "http://env:3000" },
        ]),
      },
      mockPrisma as never,
    );
    expect(config.servers).toHaveLength(2);
    expect(config.servers[0]?.name).toBe("env-server");
    expect(config.servers[1]?.name).toBe("db-server");
  });
});

describe("isMcpEnabled", () => {
  it("should return true when servers configured", () => {
    const config: McpClientConfig = {
      servers: [{ name: "test", type: "stdio", command: "node" }],
    };
    expect(isMcpEnabled(config)).toBe(true);
  });

  it("should return false when no servers configured", () => {
    const config: McpClientConfig = { servers: [] };
    expect(isMcpEnabled(config)).toBe(false);
  });

  it("owns tools only for configured server names", () => {
    const client = new McpClient({
      servers: [
        { name: "notes", type: "http", url: "http://127.0.0.1" },
        { name: "notes.extra", type: "http", url: "http://127.0.0.1" },
        { name: "off", type: "http", url: "http://127.0.0.1", disabled: true },
      ],
    });
    expect(client.ownsTool("notes.write")).toBe(true);
    expect(client.ownsTool("notes.extra.write")).toBe(true);
    expect(client.ownsTool("off.write")).toBe(false);
    expect(client.ownsTool("COMPOSIO_SEARCH_TOOLS")).toBe(false);
    expect(client.ownsTool("gmail.send")).toBe(false);
  });

  it("should ignore disabled-only configs", () => {
    const config: McpClientConfig = {
      servers: [{ name: "off", type: "http", url: "http://127.0.0.1", disabled: true }],
    };
    expect(isMcpEnabled(config)).toBe(false);
  });
});

describe("normalizeMcpServers", () => {
  it("accepts Cursor-shaped objects", async () => {
    const { normalizeMcpServers } = await import("./mcp-client.js");
    const servers = normalizeMcpServers({
      filesystem: { command: "npx", args: ["-y", "mcp-server-filesystem"] },
      notes: { url: "http://127.0.0.1:3000", headers: { Authorization: "Bearer x" } },
    });
    expect(servers).toEqual([
      {
        name: "filesystem",
        type: "stdio",
        disabled: false,
        command: "npx",
        args: ["-y", "mcp-server-filesystem"],
        env: undefined,
        url: undefined,
        headers: undefined,
      },
      {
        name: "notes",
        type: "http",
        disabled: false,
        command: undefined,
        args: undefined,
        env: undefined,
        url: "http://127.0.0.1:3000",
        headers: { Authorization: "Bearer x" },
      },
    ]);
  });
});

describe("secret helpers", () => {
  it("redacts headers and env from public views", async () => {
    const { toPublicMcpServer, mergeMcpServerSecrets, stdioChildEnv } = await import(
      "./mcp-client.js"
    );
    const publicServer = toPublicMcpServer({
      name: "notes",
      type: "http",
      url: "http://127.0.0.1:3000",
      headers: { Authorization: "Bearer secret" },
    });
    expect(publicServer).toMatchObject({ hasHeaders: true, hasEnv: false });
    expect(publicServer).not.toHaveProperty("headers");

    const merged = mergeMcpServerSecrets(
      [{ name: "notes", type: "http", url: "http://127.0.0.1:3000" }],
      [
        {
          name: "notes",
          type: "http",
          url: "http://127.0.0.1:3000",
          headers: { Authorization: "Bearer secret" },
        },
      ],
    );
    expect(merged[0]?.headers).toEqual({ Authorization: "Bearer secret" });

    const child = stdioChildEnv({ TOKEN: "x" });
    expect(child.TOKEN).toBe("x");
    expect(child.DATABASE_URL).toBeUndefined();
    expect(child.ENCRYPTION_KEY).toBeUndefined();
  });
});
