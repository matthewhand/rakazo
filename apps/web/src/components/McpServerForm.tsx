import type { McpServerConfig } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useState } from "react";

interface McpServerFormProps {
  server?: McpServerConfig;
  onSave: (server: McpServerConfig) => void;
  onCancel: () => void;
}

export function McpServerForm({ server, onSave, onCancel }: McpServerFormProps) {
  const [name, setName] = useState(server?.name ?? "");
  const [type, setType] = useState<"stdio" | "sse" | "http">(server?.type ?? "http");
  const [url, setUrl] = useState(server?.url ?? "");
  const [command, setCommand] = useState(server?.command ?? "");
  const [args, setArgs] = useState(server?.args?.join(" ") ?? "");
  const [env, setEnv] = useState(
    server?.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join("\n") : "",
  );
  const [headers, setHeaders] = useState(
    server?.headers ? Object.entries(server.headers).map(([k, v]) => `${k}=${v}`).join("\n") : "",
  );
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Server name is required");
      return;
    }

    if (type === "stdio" && !command.trim()) {
      setError("Command is required for stdio transport");
      return;
    }

    if ((type === "http" || type === "sse") && !url.trim()) {
      setError("URL is required for HTTP/SSE transport");
      return;
    }

    const envObj: Record<string, string> = {};
    if (env.trim()) {
      for (const line of env.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [key, ...valueParts] = trimmed.split("=");
        if (key) {
          envObj[key.trim()] = valueParts.join("=").trim();
        }
      }
    }

    const headersObj: Record<string, string> = {};
    if (headers.trim()) {
      for (const line of headers.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [key, ...valueParts] = trimmed.split(":");
        if (key) {
          headersObj[key.trim()] = valueParts.join(":").trim();
        }
      }
    }

    const newServer: McpServerConfig = {
      name: name.trim(),
      type,
      ...(type === "stdio"
        ? {
            command: command.trim(),
            args: args.trim() ? args.trim().split(/\s+/) : undefined,
            env: Object.keys(envObj).length > 0 ? envObj : undefined,
          }
        : {
            url: url.trim(),
            headers: Object.keys(headersObj).length > 0 ? headersObj : undefined,
          }),
    };

    onSave(newServer);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
      <div className="text-xl font-medium text-[#F1F1F2]">
        {server ? "Edit MCP Server" : "Add MCP Server"}
      </div>

      {error ? <div className="text-sm text-[#C94244]">{error}</div> : null}

      <div>
        <label className="block text-sm font-medium text-[#ECECEE] mb-1">Server Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., notion, filesystem"
          className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-3 py-2 text-[#ECECEE] outline-none"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#ECECEE] mb-1">Transport Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as "stdio" | "sse" | "http")}
          className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-3 py-2 text-[#ECECEE] outline-none"
        >
          <option value="http">HTTP</option>
          <option value="sse">SSE</option>
          <option value="stdio">stdio</option>
        </select>
      </div>

      {type === "stdio" ? (
        <>
          <div>
            <label className="block text-sm font-medium text-[#ECECEE] mb-1">Command</label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g., node, npx"
              className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-3 py-2 text-[#ECECEE] outline-none"
              required={type === "stdio"}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#ECECEE] mb-1">
              Arguments (space-separated)
            </label>
            <input
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="e.g., -y @modelcontextprotocol/server-filesystem /path"
              className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-3 py-2 text-[#ECECEE] outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#ECECEE] mb-1">
              Environment Variables (one per line: KEY=value)
            </label>
            <textarea
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              placeholder="HOME=/home/user&#10;DEBUG=true"
              rows={3}
              className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-3 py-2 text-[#ECECEE] outline-none font-mono text-sm"
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-[#ECECEE] mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="e.g., http://localhost:3000"
              className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-3 py-2 text-[#ECECEE] outline-none"
              required={type !== "stdio"}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#ECECEE] mb-1">
              Headers (one per line: Key: value)
            </label>
            <textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder="Authorization: Bearer token&#10;X-Custom-Header: value"
              rows={3}
              className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-3 py-2 text-[#ECECEE] outline-none font-mono text-sm"
            />
            <p className="mt-1 text-xs text-[#7A7A80]">
              Warning: Headers are stored but never displayed for security
            </p>
          </div>
        </>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="pill" size="sm">
          Save
        </Button>
        <Button type="button" variant="pill" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
