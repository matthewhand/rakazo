import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { McpClient, parseMcpConfig, isMcpEnabled, type McpClientConfig } from "./mcp-client.js";
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
    const config = parseMcpConfig(envVars);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0]?.name).toBe("test");
    expect(config.servers[0]?.type).toBe("stdio");
  });

  it("should return empty config when no env vars set", () => {
    const config = parseMcpConfig({});
    expect(config.servers).toHaveLength(0);
  });

  it("should handle malformed JSON in MCP_SERVERS", () => {
    const config = parseMcpConfig({ MCP_SERVERS: "not json" });
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

  it("should filter disabled servers from database", async () => {
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
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0]?.name).toBe("enabled");
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

  it("should return true when config is a promise", () => {
    const config = Promise.resolve({ servers: [] });
    expect(isMcpEnabled(config)).toBe(true);
  });
});
