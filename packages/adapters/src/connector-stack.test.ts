import { describe, expect, it } from "vitest";
import type { AdapterContext, ConnectorEvent } from "@rakazo/adapter-kit";
import {
  type ComposioProvider,
  CompositeConnector,
  createConnectorStack,
} from "./composio-connector.js";
import { DestinationEmulator } from "./destination-emulator.js";

const context: AdapterContext = {
  operationId: "op",
  traceId: "tr",
  workspaceId: "ws",
  userId: "user",
  signal: new AbortController().signal,
};

async function collect(events: AsyncIterable<ConnectorEvent>) {
  const out: ConnectorEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function fakeMcp(opts: { owns: (tool: string) => boolean; label: string }) {
  return {
    ownsTool: opts.owns,
    async discoverTools() {
      return [
        {
          name: `${opts.label}.write`,
          description: opts.label,
          inputSchema: { type: "object", properties: {} },
        },
      ];
    },
    async *execute() {
      yield { type: "result" as const, data: { from: opts.label } };
    },
  };
}

describe("CompositeConnector routing", () => {
  it("sends destination.write to the destination emulator", async () => {
    const destination = new DestinationEmulator();
    const connector = new CompositeConnector(
      destination,
      undefined,
      fakeMcp({ owns: () => true, label: "notes" }),
    );
    const events = await collect(
      connector.execute(
        {
          tool: "destination.write",
          args: { collection: "n", title: "t", body: "b" },
          executionId: "e1",
        },
        context,
      ),
    );
    expect(events.some((event) => event.type === "result")).toBe(true);
  });

  it("does not send dotted Composio-style names to MCP when ownsTool is false", async () => {
    const destination = new DestinationEmulator();
    const mcp = fakeMcp({ owns: () => false, label: "notes" });
    const connector = new CompositeConnector(destination, undefined, mcp);
    const events = await collect(
      connector.execute({ tool: "gmail.send", args: {}, executionId: "e2" }, context),
    );
    expect(events).toEqual([{ type: "error", message: "Unknown tool: gmail.send" }]);
  });

  it("routes owned MCP names to the MCP client", async () => {
    const destination = new DestinationEmulator();
    const mcp = fakeMcp({ owns: (tool) => tool.startsWith("notes."), label: "notes" });
    const connector = new CompositeConnector(destination, undefined, mcp);
    const events = await collect(
      connector.execute({ tool: "notes.write", args: {}, executionId: "e3" }, context),
    );
    expect(events).toEqual([{ type: "result", data: { from: "notes" } }]);
  });

  it("discovers destination tools even when MCP also reports tools", async () => {
    const destination = new DestinationEmulator();
    const connector = new CompositeConnector(
      destination,
      undefined,
      fakeMcp({ owns: () => true, label: "notes" }),
    );
    const tools = await connector.discoverTools(context);
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["destination.write", "notes.write"]),
    );
  });
});

describe("createConnectorStack", () => {
  it("keeps a Composio override in the second argument after MCP was added", () => {
    const override: ComposioProvider = {
      describe: () => ({
        id: "composio-emulator",
        contractVersion: "1",
        adapterVersion: "0.1.0",
        capabilities: { discover: true, oauth: false, secretsBrokered: false },
      }),
      async discoverTools() {
        return [];
      },
      async *execute() {
        yield { type: "error", message: "unused" };
      },
      async catalog() {
        return [];
      },
      async warmDirectory() {},
      async connectionReady() {
        return false;
      },
      async begin() {
        return { authorizationUrl: null, state: "x" };
      },
      async complete() {
        return { connectionRef: "x" };
      },
      async revoke() {},
    };
    const stack = createConnectorStack(true, override, fakeMcp({ owns: () => false, label: "notes" }));
    expect(stack.composio?.describe().id).toBe("composio-emulator");
    expect(stack.mcp).toBeTruthy();
  });

  it("does not construct a live Composio client when disabled and no override", () => {
    const stack = createConnectorStack(false);
    expect(stack.composio).toBeUndefined();
    expect(stack.mcp).toBeUndefined();
  });
});
