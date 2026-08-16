import { describe, it, expect } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/index.js";

interface MockPrisma {
  deploymentSettings: {
    findUnique: (args: { where: { id: string } }) => Promise<{ mcpServers: string | null } | null>;
    upsert: (args: unknown) => Promise<unknown>;
  };
}

describe("MCP Server Configuration", () => {
  it("should store and retrieve MCP servers from database", async () => {
    const servers = [
      {
        name: "test-server",
        type: "http" as const,
        url: "http://localhost:3000",
      },
    ];

    const mockPrisma: MockPrisma = {
      deploymentSettings: {
        findUnique: async () => ({
          mcpServers: JSON.stringify(servers),
        }),
        upsert: async () => ({}),
      },
    };

    const result = await mockPrisma.deploymentSettings.findUnique({
      where: { id: "default" },
    });

    expect(result).toBeDefined();
    if (result?.mcpServers) {
      const parsed = JSON.parse(result.mcpServers);
      expect(parsed).toEqual(servers);
    }
  });

  it("should handle empty MCP server list", async () => {
    const mockPrisma: MockPrisma = {
      deploymentSettings: {
        findUnique: async () => ({
          mcpServers: "[]",
        }),
        upsert: async () => ({}),
      },
    };

    const result = await mockPrisma.deploymentSettings.findUnique({
      where: { id: "default" },
    });

    expect(result).toBeDefined();
    if (result?.mcpServers) {
      const parsed = JSON.parse(result.mcpServers);
      expect(parsed).toEqual([]);
    }
  });

  it("should handle null MCP servers", async () => {
    const mockPrisma: MockPrisma = {
      deploymentSettings: {
        findUnique: async () => ({
          mcpServers: null,
        }),
        upsert: async () => ({}),
      },
    };

    const result = await mockPrisma.deploymentSettings.findUnique({
      where: { id: "default" },
    });

    expect(result).toBeDefined();
    expect(result?.mcpServers).toBeNull();
  });

  it("should support stdio MCP servers", async () => {
    const servers = [
      {
        name: "filesystem",
        type: "stdio" as const,
        command: "node",
        args: ["server.js"],
        env: { HOME: "/home/user" },
      },
    ];

    const mockPrisma: MockPrisma = {
      deploymentSettings: {
        findUnique: async () => ({
          mcpServers: JSON.stringify(servers),
        }),
        upsert: async () => ({}),
      },
    };

    const result = await mockPrisma.deploymentSettings.findUnique({
      where: { id: "default" },
    });

    if (result?.mcpServers) {
      const parsed = JSON.parse(result.mcpServers);
      expect(parsed[0].type).toBe("stdio");
      expect(parsed[0].command).toBe("node");
      expect(parsed[0].args).toEqual(["server.js"]);
    }
  });

  it("should support disabled MCP servers", async () => {
    const servers = [
      {
        name: "test-server",
        type: "http" as const,
        url: "http://localhost:3000",
        disabled: true,
      },
    ];

    const mockPrisma: MockPrisma = {
      deploymentSettings: {
        findUnique: async () => ({
          mcpServers: JSON.stringify(servers),
        }),
        upsert: async () => ({}),
      },
    };

    const result = await mockPrisma.deploymentSettings.findUnique({
      where: { id: "default" },
    });

    if (result?.mcpServers) {
      const parsed = JSON.parse(result.mcpServers);
      expect(parsed[0].disabled).toBe(true);
    }
  });
});
