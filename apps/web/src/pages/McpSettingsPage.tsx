import type { McpServerConfig, McpServerStatus } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

interface McpServer extends McpServerConfig {
  status?: McpServerStatus;
}

export function McpSettingsPage({ onClose }: { onClose: () => void }) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [statuses, setStatuses] = useState<Map<string, McpServerStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [editingIndex, setEditingIndex] = useState<number | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadServers() {
    try {
      const [serversResult, statusResult] = await Promise.all([
        rpc.mcp.list(),
        rpc.mcp.status().catch(() => ({ servers: [] })),
      ]);

      const statusMap = new Map(statusResult.servers.map((s) => [s.name, s]));
      setStatuses(statusMap);

      const enrichedServers = serversResult.servers.map((server) => ({
        ...server,
        status: statusMap.get(server.name),
      }));

      setServers(enrichedServers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers");
    } finally {
      setLoading(false);
    }
  }

  async function saveServers(newServers: McpServerConfig[]) {
    setSaving(true);
    setError(null);
    try {
      await rpc.mcp.update({ servers: newServers });
      setEditingIndex(null);
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save servers");
    } finally {
      setSaving(false);
    }
  }

  async function deleteServer(index: number) {
    const newServers = servers.filter((_, i) => i !== index);
    await saveServers(newServers);
  }

  async function toggleServer(index: number) {
    const newServers = servers.map((s, i) =>
      i === index ? { ...s, disabled: !s.disabled } : s,
    );
    await saveServers(newServers);
  }

  useEffect(() => {
    void loadServers();
    const interval = setInterval(() => {
      void rpc.mcp.status().then((result) => {
        const statusMap = new Map(result.servers.map((s) => [s.name, s]));
        setStatuses(statusMap);
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[#7A7A80]">Loading MCP servers...</div>
      </div>
    );
  }

  if (editingIndex !== null) {
    return (
      <McpServerEditor
        server={editingIndex === "new" ? undefined : servers[editingIndex]}
        onSave={(server) => {
          const newServers =
            editingIndex === "new"
              ? [...servers, server]
              : servers.map((s, i) => (i === editingIndex ? server : s));
          void saveServers(newServers);
        }}
        onCancel={() => setEditingIndex(null)}
        saving={saving}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#0A0A0B]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1C1C1E] px-8 py-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#F1F1F2]">MCP Servers</h1>
          <p className="mt-1 text-sm text-[#7A7A80]">
            Connect remote tools and APIs without requiring Composio
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[#7A7A80] hover:text-[#ECECEE] transition-colors"
          aria-label="Close"
        >
          <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-8 mt-4 rounded-lg bg-[#C94244]/10 border border-[#C94244]/20 px-4 py-3">
          <p className="text-sm text-[#C94244]">{error}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {servers.length === 0 ? (
          <EmptyState onAddServer={() => setEditingIndex("new")} />
        ) : (
          <div className="space-y-3">
            {servers.map((server, index) => {
              const status = statuses.get(server.name);
              return (
                <ServerCard
                  key={index}
                  server={server}
                  status={status}
                  onEdit={() => setEditingIndex(index)}
                  onDelete={() => void deleteServer(index)}
                  onToggle={() => void toggleServer(index)}
                  disabled={saving}
                />
              );
            })}
          </div>
        )}

        {servers.length > 0 && (
          <button
            type="button"
            onClick={() => setEditingIndex("new")}
            disabled={saving}
            className="mt-6 flex items-center gap-2 rounded-lg border-2 border-dashed border-[#2C2C30] px-4 py-3 text-[#7A7A80] hover:border-[#3C3C40] hover:text-[#ECECEE] transition-colors w-full justify-center disabled:opacity-50"
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14m-7-7h14" />
            </svg>
            Add Another Server
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onAddServer }: { onAddServer: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-6 rounded-full bg-[#1C1C1E] p-6">
        <svg
          width="48"
          height="48"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-[#7A7A80]"
        >
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <circle cx="12" cy="14" r="2" />
          <path d="M18 12h2a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2v-7a2 2 0 012-2h2" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-[#F1F1F2] mb-2">No MCP Servers Configured</h3>
      <p className="text-sm text-[#7A7A80] max-w-md mb-6">
        Model Context Protocol (MCP) servers provide tools and capabilities to your bots. Connect
        to services like Notion, file systems, databases, or custom APIs.
      </p>
      <Button type="button" variant="pill" onClick={onAddServer}>
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" className="mr-2">
          <path d="M8 3v10m-5-5h10" />
        </svg>
        Add Your First Server
      </Button>
      <div className="mt-8 text-left max-w-md">
        <p className="text-xs font-medium text-[#7A7A80] mb-3">Popular examples:</p>
        <div className="space-y-2 text-xs text-[#6C6C70]">
          <div className="flex items-start gap-2">
            <span className="text-[#7A7A80]">•</span>
            <span>
              <strong className="text-[#ECECEE]">Notion</strong> - Read and write pages, databases
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#7A7A80]">•</span>
            <span>
              <strong className="text-[#ECECEE]">Filesystem</strong> - Access local files and directories
            </span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-[#7A7A80]">•</span>
            <span>
              <strong className="text-[#ECECEE]">APIs.guru</strong> - Discover and use public APIs
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ServerCard({
  server,
  status,
  onEdit,
  onDelete,
  onToggle,
  disabled,
}: {
  server: McpServerConfig;
  status?: McpServerStatus;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  disabled: boolean;
}) {
  const isDisabled = server.disabled;
  const isError = status?.status === "error";
  const isConnected = status?.status === "connected";

  return (
    <div
      className={`rounded-xl border bg-[#141416] p-5 transition-all ${
        isDisabled
          ? "border-[#26262A] opacity-60"
          : isError
            ? "border-[#C94244]/30"
            : isConnected
              ? "border-[#34C759]/30"
              : "border-[#26262A]"
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className={`flex-shrink-0 rounded-lg p-3 ${
            isDisabled
              ? "bg-[#1C1C1E]"
              : isError
                ? "bg-[#C94244]/10"
                : isConnected
                  ? "bg-[#34C759]/10"
                  : "bg-[#1C1C1E]"
          }`}
        >
          {server.type === "stdio" ? (
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#ECECEE]">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M6 7h12M6 11h8" />
            </svg>
          ) : (
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[#ECECEE]">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h3 className="text-base font-medium text-[#F1F1F2] truncate">{server.name}</h3>
                <StatusBadge status={status?.status ?? (isDisabled ? "disabled" : "error")} />
              </div>
              <p className="mt-1 text-sm text-[#7A7A80] truncate">
                {server.type === "stdio"
                  ? `${server.command} ${(server.args ?? []).join(" ")}`
                  : server.url}
              </p>
              {status && status.status === "connected" && status.toolCount > 0 && (
                <p className="mt-1 text-xs text-[#6C6C70]">
                  {status.toolCount} tool{status.toolCount === 1 ? "" : "s"} available
                </p>
              )}
              {status?.error && (
                <p className="mt-1 text-xs text-[#C94244]">{status.error}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onToggle}
                disabled={disabled}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#7A7A80] hover:bg-[#1C1C1E] hover:text-[#ECECEE] transition-colors disabled:opacity-50"
              >
                {isDisabled ? "Enable" : "Disable"}
              </button>
              <button
                type="button"
                onClick={onEdit}
                disabled={disabled}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#7A7A80] hover:bg-[#1C1C1E] hover:text-[#ECECEE] transition-colors disabled:opacity-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={disabled}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#C94244] hover:bg-[#C94244]/10 transition-colors disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "connected" | "error" | "disabled" }) {
  const config = {
    connected: {
      bg: "bg-[#34C759]/10",
      text: "text-[#34C759]",
      label: "Connected",
      dot: "bg-[#34C759]",
    },
    error: {
      bg: "bg-[#C94244]/10",
      text: "text-[#C94244]",
      label: "Error",
      dot: "bg-[#C94244]",
    },
    disabled: {
      bg: "bg-[#3C3C40]/10",
      text: "text-[#7A7A80]",
      label: "Disabled",
      dot: "bg-[#7A7A80]",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bg} ${config.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function McpServerEditor({
  server,
  onSave,
  onCancel,
  saving,
}: {
  server?: McpServerConfig;
  onSave: (server: McpServerConfig) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(server?.name ?? "");
  const [type, setType] = useState<"stdio" | "sse" | "http">(server?.type ?? "http");
  const [url, setUrl] = useState(server?.url ?? "");
  const [command, setCommand] = useState(server?.command ?? "");
  const [args, setArgs] = useState(server?.args?.join(" ") ?? "");
  const [env, setEnv] = useState(
    server?.env ? Object.entries(server.env).map(([k, v]) => `${k}=${v}`).join("\n") : "",
  );
  const [headers, setHeaders] = useState(
    server?.headers ? Object.entries(server.headers).map(([k, v]) => `${k}: ${v}`).join("\n") : "",
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
        if (key) envObj[key.trim()] = valueParts.join("=").trim();
      }
    }

    const headersObj: Record<string, string> = {};
    if (headers.trim()) {
      for (const line of headers.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [key, ...valueParts] = trimmed.split(":");
        if (key) headersObj[key.trim()] = valueParts.join(":").trim();
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
    <div className="flex h-full flex-col bg-[#0A0A0B]">
      <div className="border-b border-[#1C1C1E] px-8 py-6">
        <h2 className="text-xl font-semibold text-[#F1F1F2]">
          {server ? "Edit Server" : "Add Server"}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-8 py-6">
        {error && (
          <div className="mb-6 rounded-lg bg-[#C94244]/10 border border-[#C94244]/20 px-4 py-3">
            <p className="text-sm text-[#C94244]">{error}</p>
          </div>
        )}

        <div className="space-y-6 max-w-2xl">
          <div>
            <label className="block text-sm font-medium text-[#ECECEE] mb-2">
              Server Name
              <span className="text-[#C94244] ml-1">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., notion, filesystem, apis-guru"
              className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-4 py-3 text-[#ECECEE] placeholder-[#6C6C70] outline-none focus:border-[#3C3C40] transition-colors"
              required
            />
            <p className="mt-1.5 text-xs text-[#6C6C70]">
              A unique identifier for this server. Used in tool names like{" "}
              <code className="text-[#ECECEE]">{name || "server"}.tool_name</code>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#ECECEE] mb-2">
              Transport Type
              <span className="text-[#C94244] ml-1">*</span>
            </label>
            <div className="grid grid-cols-3 gap-3">
              {(["http", "sse", "stdio"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
                    type === t
                      ? "border-[#F1F1F2] bg-[#F1F1F2]/5 text-[#F1F1F2]"
                      : "border-[#26262A] text-[#7A7A80] hover:border-[#3C3C40] hover:text-[#ECECEE]"
                  }`}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-[#6C6C70]">
              {type === "stdio"
                ? "Run a local command (like npx or node)"
                : "Connect to a remote HTTP endpoint"}
            </p>
          </div>

          {type === "stdio" ? (
            <>
              <div>
                <label className="block text-sm font-medium text-[#ECECEE] mb-2">
                  Command
                  <span className="text-[#C94244] ml-1">*</span>
                </label>
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="e.g., npx, node, python"
                  className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-4 py-3 text-[#ECECEE] placeholder-[#6C6C70] outline-none focus:border-[#3C3C40] transition-colors font-mono"
                  required={type === "stdio"}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#ECECEE] mb-2">
                  Arguments <span className="text-[#6C6C70] font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="e.g., -y @modelcontextprotocol/server-filesystem /path"
                  className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-4 py-3 text-[#ECECEE] placeholder-[#6C6C70] outline-none focus:border-[#3C3C40] transition-colors font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#ECECEE] mb-2">
                  Environment Variables <span className="text-[#6C6C70] font-normal">(optional)</span>
                </label>
                <textarea
                  value={env}
                  onChange={(e) => setEnv(e.target.value)}
                  placeholder={"HOME=/home/user\nDEBUG=true"}
                  rows={4}
                  className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-4 py-3 text-[#ECECEE] placeholder-[#6C6C70] outline-none focus:border-[#3C3C40] transition-colors font-mono text-sm resize-none"
                />
                <p className="mt-1.5 text-xs text-[#6C6C70]">One per line: KEY=value</p>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-[#ECECEE] mb-2">
                  URL
                  <span className="text-[#C94244] ml-1">*</span>
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="e.g., http://localhost:3000"
                  className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-4 py-3 text-[#ECECEE] placeholder-[#6C6C70] outline-none focus:border-[#3C3C40] transition-colors font-mono"
                  required={type !== "stdio"}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#ECECEE] mb-2">
                  Headers <span className="text-[#6C6C70] font-normal">(optional)</span>
                </label>
                <textarea
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  placeholder={"Authorization: Bearer token\nX-API-Key: your-key"}
                  rows={4}
                  className="w-full rounded-lg border border-[#26262A] bg-[#101012] px-4 py-3 text-[#ECECEE] placeholder-[#6C6C70] outline-none focus:border-[#3C3C40] transition-colors font-mono text-sm resize-none"
                />
                <p className="mt-1.5 text-xs text-[#6C6C70]">
                  One per line: Header-Name: value
                  <br />
                  <span className="text-[#C94244]">⚠ Headers are stored but never displayed</span>
                </p>
              </div>
            </>
          )}
        </div>

        <div className="mt-8 flex gap-3 pt-6 border-t border-[#1C1C1E]">
          <Button type="submit" variant="pill" disabled={saving}>
            {saving ? "Saving..." : "Save Server"}
          </Button>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[#7A7A80] hover:bg-[#1C1C1E] hover:text-[#ECECEE] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
