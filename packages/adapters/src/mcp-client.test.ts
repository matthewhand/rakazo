import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterContext } from "@rakazo/adapter-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isMcpEnabled,
  McpClient,
  type McpClientConfig,
  matchMcpServer,
  mergeMcpServerSecrets,
  parseMcpConfig,
  parseMcpConfigFromEnv,
} from "./mcp-client.js";
import { McpEmulator } from "./mcp-emulator.js";

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

  it("does not connect or advertise tools for disabled servers", async () => {
    const config: McpClientConfig = {
      servers: [
        { name: "live", type: "sse", url: `http://127.0.0.1:${port}` },
        { name: "off", type: "sse", url: `http://127.0.0.1:${port}`, disabled: true },
      ],
    };
    client = new McpClient(config);
    const tools = await client.discoverTools(mockContext);
    expect(tools.map((tool) => tool.name)).toEqual(["live.notes.write"]);
    const status = await client.getServerStatus();
    expect(status).toEqual([
      expect.objectContaining({ name: "live", status: "connected", toolCount: 1 }),
      expect.objectContaining({ name: "off", status: "disabled", toolCount: 0 }),
    ]);
  });

  it("rejects execute against a disabled server instead of opening a transport", async () => {
    client = new McpClient({
      servers: [{ name: "off", type: "sse", url: `http://127.0.0.1:${port}`, disabled: true }],
    });
    await client.initialize();
    const events: Array<{ type: string; message?: string }> = [];
    for await (const event of client.execute(
      { tool: "off.notes.write", args: {}, executionId: "disabled-exec" },
      mockContext,
    )) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "error", message: "MCP server off not found or not connected" },
    ]);
    expect(emulator.writes).toHaveLength(0);
  });

  it("reloads from a new config and drops the previous server", async () => {
    client = new McpClient({
      servers: [{ name: "old", type: "sse", url: `http://127.0.0.1:${port}` }],
    });
    await client.initialize();
    expect((await client.discoverTools(mockContext)).map((tool) => tool.name)).toEqual([
      "old.notes.write",
    ]);

    await client.reload({
      servers: [{ name: "new", type: "sse", url: `http://127.0.0.1:${port}` }],
    });
    expect((await client.discoverTools(mockContext)).map((tool) => tool.name)).toEqual([
      "new.notes.write",
    ]);
    expect(client.ownsTool("old.notes.write")).toBe(false);
    expect(client.ownsTool("new.notes.write")).toBe(true);
  });

  it("does not refresh from the database after close", async () => {
    let sourceCalls = 0;
    const closed = new McpClient({ servers: [] }, async () => {
      sourceCalls += 1;
      return { servers: [] };
    });
    await closed.close();
    await closed.initialize();
    expect(sourceCalls).toBe(0);
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

  it("keeps the first server when file and env share a name", () => {
    const dir = mkdtempSync(join(tmpdir(), "rakazo-mcp-"));
    const path = join(dir, "mcp.json");
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: { notes: { url: "http://127.0.0.1:1111" } },
      }),
    );
    const config = parseMcpConfigFromEnv({
      MCP_CONFIG_PATH: path,
      MCP_SERVERS: JSON.stringify([{ name: "notes", type: "http", url: "http://127.0.0.1:2222" }]),
    });
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0]?.url).toBe("http://127.0.0.1:1111");
  });

  it("loads Cursor-shaped servers from MCP_CONFIG_PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "rakazo-mcp-"));
    const path = join(dir, "mcp.json");
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          notes: { url: "http://127.0.0.1:3000", headers: { Authorization: "Bearer x" } },
        },
      }),
    );
    const config = parseMcpConfigFromEnv({ MCP_CONFIG_PATH: path });
    expect(config.servers).toEqual([
      expect.objectContaining({
        name: "notes",
        type: "http",
        url: "http://127.0.0.1:3000",
        headers: { Authorization: "Bearer x" },
      }),
    ]);
  });

  it("returns an empty config when MCP_CONFIG_PATH is unreadable", () => {
    const config = parseMcpConfigFromEnv({
      MCP_CONFIG_PATH: join(tmpdir(), "rakazo-mcp-missing", "nope.json"),
    });
    expect(config.servers).toHaveLength(0);
  });

  it("should load servers from database when prisma is provided", async () => {
    const mockPrisma = {
      deploymentSettings: {
        findUnique: async () => ({
          mcpServers: JSON.stringify([{ name: "db-server", type: "http", url: "http://db:3000" }]),
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
          mcpServers: JSON.stringify([{ name: "db-server", type: "http", url: "http://db:3000" }]),
        }),
      },
    };

    const config = await parseMcpConfig(
      {
        MCP_SERVERS: JSON.stringify([{ name: "env-server", type: "http", url: "http://env:3000" }]),
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

describe("matchMcpServer", () => {
  const servers = [
    { name: "notes", type: "http" as const, url: "http://127.0.0.1" },
    { name: "notes.extra", type: "http" as const, url: "http://127.0.0.1" },
    { name: "off", type: "http" as const, url: "http://127.0.0.1", disabled: true },
  ];

  it("picks the longest matching server name", () => {
    expect(matchMcpServer(servers, "notes.extra.write")?.name).toBe("notes.extra");
    expect(matchMcpServer(servers, "notes.write")?.name).toBe("notes");
    expect(matchMcpServer(servers, "notes")?.name).toBe("notes");
  });

  it("skips disabled servers unless includeDisabled is set", () => {
    expect(matchMcpServer(servers, "off.write")).toBeUndefined();
    expect(matchMcpServer(servers, "off.write", { includeDisabled: true })?.name).toBe("off");
  });

  it("does not treat a sibling prefix as a match", () => {
    expect(matchMcpServer(servers, "notesextra.write")).toBeUndefined();
    expect(matchMcpServer(servers, "gmail.send")).toBeUndefined();
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

  it("carries secrets across a one-to-one rename", () => {
    const merged = mergeMcpServerSecrets(
      [{ name: "renamed", type: "http", url: "http://127.0.0.1:3000" }],
      [
        {
          name: "notes",
          type: "http",
          url: "http://127.0.0.1:3000",
          headers: { Authorization: "Bearer secret" },
          env: { TOKEN: "x" },
        },
      ],
    );
    expect(merged[0]).toMatchObject({
      name: "renamed",
      headers: { Authorization: "Bearer secret" },
      env: { TOKEN: "x" },
    });
  });

  it("does not guess secrets when more than one name changed", () => {
    const merged = mergeMcpServerSecrets(
      [{ name: "other", type: "http", url: "http://127.0.0.1:3000" }],
      [
        {
          name: "notes",
          type: "http",
          url: "http://127.0.0.1:3000",
          headers: { Authorization: "Bearer secret" },
        },
        { name: "slack", type: "http", url: "http://127.0.0.1:4000" },
      ],
    );
    expect(merged[0]?.headers).toBeUndefined();
  });

  it("lets an explicit blank replacement drop stored secrets", () => {
    const merged = mergeMcpServerSecrets(
      [
        {
          name: "notes",
          type: "http",
          url: "http://127.0.0.1:3000",
          headers: {},
        },
      ],
      [
        {
          name: "notes",
          type: "http",
          url: "http://127.0.0.1:3000",
          headers: { Authorization: "Bearer secret" },
        },
      ],
    );
    expect(merged[0]?.headers).toEqual({});
  });
});
