import { describe, expect, it } from "vitest";
import {
  appContract,
  CreateBotInput,
  McpServerConfigSchema,
  McpServerPublicSchema,
  McpServersListSchema,
  McpServersPublicListSchema,
  ProductEventType,
} from "./index.js";

describe("contracts", () => {
  it("parses bot create input", () => {
    const parsed = CreateBotInput.parse({ name: "Chief" });
    expect(parsed.title).toBe("");
    expect(parsed.notifyOnFinish).toBe(true);
  });

  it("exposes the product rpc surface", () => {
    expect(appContract.models.beginOAuth).toBeTruthy();
    expect(appContract.bootstrap).toBeTruthy();
    expect(appContract.models.completeOAuth).toBeTruthy();
    expect(appContract.bots.create).toBeTruthy();
    expect(appContract.bots.archive).toBeTruthy();
    expect(appContract.bots.restore).toBeTruthy();
    expect(appContract.bots.remove).toBeTruthy();
    expect(appContract.threads.subscribe).toBeTruthy();
    expect(appContract.notifications.registerPush).toBeTruthy();
    expect(ProductEventType.options).toContain("thread.message.created");
    expect(ProductEventType.options).toContain("thread.subagent");
    expect(ProductEventType.options).toContain("bot.spawned");
    expect(appContract.mcp.list).toBeTruthy();
    expect(appContract.mcp.update).toBeTruthy();
    expect(appContract.mcp.status).toBeTruthy();
  });
});

describe("MCP public contracts", () => {
  it("accepts Cursor-safe server names and rejects spaces", () => {
    expect(McpServerConfigSchema.parse({ name: "notes.extra", type: "http" }).name).toBe(
      "notes.extra",
    );
    expect(() => McpServerConfigSchema.parse({ name: "notes extra", type: "http" })).toThrow();
    expect(() => McpServerConfigSchema.parse({ name: "", type: "stdio" })).toThrow();
    expect(() =>
      McpServersListSchema.parse({
        servers: [
          { name: "notes", type: "http" },
          { name: "notes", type: "sse" },
        ],
      }),
    ).toThrow(/unique/i);
  });

  it("strips headers and env from the list schema so clients cannot read secrets", () => {
    const listed = McpServerPublicSchema.parse({
      name: "notes",
      type: "http",
      url: "http://127.0.0.1:3000",
      hasHeaders: true,
      hasEnv: false,
    });
    expect(listed).not.toHaveProperty("headers");
    expect(listed).not.toHaveProperty("env");
    expect(listed.hasHeaders).toBe(true);

    const rejected = McpServersPublicListSchema.safeParse({
      servers: [
        {
          name: "notes",
          type: "http",
          url: "http://127.0.0.1:3000",
          headers: { Authorization: "Bearer secret" },
          hasHeaders: true,
          hasEnv: false,
        },
      ],
    });
    expect(rejected.success).toBe(true);
    if (rejected.success) {
      expect(rejected.data.servers[0]).not.toHaveProperty("headers");
    }
  });
});
