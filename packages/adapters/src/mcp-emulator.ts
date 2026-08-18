import { createServer, type Server, type ServerResponse } from "node:http";

export interface McpCall {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpEmulator {
  private server: Server | undefined;
  private sse: ServerResponse | undefined;
  port = 0;
  readonly writes: Array<{ path: string; text: string }> = [];

  async start(port = 0): Promise<number> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/sse")) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        this.sse = res;
        res.write(`event: endpoint\ndata: /message\n\n`);
        req.on("close", () => {
          if (this.sse === res) this.sse = undefined;
        });
        return;
      }

      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk as Buffer));
        req.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as McpCall;
            const response = this.handleMcpCall(body);
            if (response) this.pushSse(response);
            res.writeHead(202).end();
          } catch {
            res.writeHead(400, { "content-type": "application/json" }).end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32700, message: "Parse error" },
              }),
            );
          }
        });
        return;
      }

      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => this.server?.listen(port, "127.0.0.1", () => resolve()));
    const addr = this.server.address();
    this.port = typeof addr === "object" && addr ? addr.port : port;
    return this.port;
  }

  private pushSse(message: McpResponse) {
    this.sse?.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
  }

  private handleMcpCall(call: McpCall): McpResponse | undefined {
    if (call.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: call.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "rakazo-mcp-emulator", version: "0.1.0" },
        },
      };
    }

    if (call.method === "notifications/initialized" || call.method?.startsWith("notifications/")) {
      return undefined;
    }

    if (call.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: call.id,
        result: {
          tools: [
            {
              name: "notes.write",
              description: "Write a note in the destination filesystem",
              inputSchema: {
                type: "object",
                properties: { path: { type: "string" }, text: { type: "string" } },
              },
            },
          ],
        },
      };
    }

    if (call.method === "tools/call") {
      const params = call.params ?? {};
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as { path?: string; text?: string };

      if (name === "notes.write") {
        this.writes.push({ path: args.path ?? "note.md", text: args.text ?? "" });
        return {
          jsonrpc: "2.0",
          id: call.id,
          result: {
            content: [{ type: "text", text: `Wrote note to ${args.path ?? "note.md"}` }],
          },
        };
      }
    }

    return {
      jsonrpc: "2.0",
      id: call.id,
      error: { code: -32601, message: "Method not found" },
    };
  }

  async stop(): Promise<void> {
    this.sse?.end();
    this.sse = undefined;
    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  inspect() {
    return { writes: this.writes };
  }
}
