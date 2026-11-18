import type { McpServerPublic, McpServerStatus } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { type FormEvent, useEffect, useState } from "react";
import { rpc } from "../lib/rpc";

export function McpServersTab({
  canManage,
  onEditorOpenChange,
}: {
  canManage: boolean;
  onEditorOpenChange?: (open: boolean) => void;
}) {
  const [servers, setServers] = useState<McpServerPublic[]>([]);
  const [statuses, setStatuses] = useState<Map<string, McpServerStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | "new" | null>(null);

  function setEditor(next: number | "new" | null) {
    setEditingIndex(next);
    onEditorOpenChange?.(next !== null);
  }
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function loadServers() {
    try {
      const [serversResult, statusResult] = await Promise.all([
        rpc.mcp.list(),
        rpc.mcp.status().catch(() => ({ servers: [] })),
      ]);
      const statusMap = new Map(statusResult.servers.map((server) => [server.name, server]));
      setStatuses(statusMap);
      setServers(serversResult.servers);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load servers");
    } finally {
      setLoading(false);
    }
  }

  async function saveServers(
    next: Array<McpServerPublic | Parameters<typeof rpc.mcp.update>[0]["servers"][number]>,
  ) {
    setSaving(true);
    setError(null);
    try {
      await rpc.mcp.update({
        servers: next.map((server) => ({
          name: server.name,
          type: server.type,
          command: server.command,
          args: server.args,
          url: server.url,
          disabled: server.disabled,
          ...("headers" in server ? { headers: server.headers } : {}),
          ...("env" in server ? { env: server.env } : {}),
        })),
      });
      setEditor(null);
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save servers");
    } finally {
      setSaving(false);
    }
  }

  async function deleteServer(index: number) {
    const server = servers[index];
    if (!server) return;
    if (!window.confirm(`Remove MCP server “${server.name}”?`)) return;
    await saveServers(servers.filter((_, i) => i !== index));
  }

  async function toggleServer(index: number) {
    await saveServers(
      servers.map((server, i) =>
        i === index ? { ...server, disabled: !server.disabled } : server,
      ),
    );
  }

  useEffect(() => {
    void loadServers();
    const interval = window.setInterval(() => {
      void rpc.mcp
        .status()
        .then((result) =>
          setStatuses(new Map(result.servers.map((server) => [server.name, server]))),
        )
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[#7A7A80]">
        Loading MCP servers…
      </div>
    );
  }

  if (editingIndex !== null) {
    return (
      <McpServerEditor
        server={editingIndex === "new" ? undefined : servers[editingIndex]}
        existingNames={servers.map((server) => server.name)}
        onSave={(server) => {
          const next =
            editingIndex === "new"
              ? [...servers, server]
              : servers.map((item, i) => (i === editingIndex ? { ...item, ...server } : item));
          void saveServers(next);
        }}
        onCancel={() => setEditor(null)}
        saving={saving}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
      {error || loadError ? (
        <div className="mb-4 rounded-lg border border-[#C94244]/20 bg-[#C94244]/10 px-4 py-3">
          <p className="text-sm text-[#C94244]">{error ?? loadError}</p>
        </div>
      ) : null}

      {!canManage ? (
        <p className="mb-4 text-sm text-[#7A7A80]">
          Only the deployment owner can add or edit MCP servers.
        </p>
      ) : null}

      {servers.length === 0 && !loadError ? (
        <EmptyState onAddServer={canManage ? () => setEditor("new") : undefined} />
      ) : servers.length === 0 ? null : (
        <>
          <div className="space-y-3">
            {servers.map((server, index) => (
              <ServerCard
                key={server.name}
                server={server}
                status={statuses.get(server.name)}
                canManage={canManage}
                onEdit={() => setEditor(index)}
                onDelete={() => void deleteServer(index)}
                onToggle={() => void toggleServer(index)}
                disabled={saving}
              />
            ))}
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={() => setEditor("new")}
              disabled={saving}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#2C2C30] px-4 py-3 text-[#7A7A80] transition-colors hover:border-[#3C3C40] hover:text-[#ECECEE] disabled:opacity-50"
            >
              Add another server
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function EmptyState({ onAddServer }: { onAddServer?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <h3 className="mb-2 text-base font-medium text-[#F1F1F2]">No MCP servers configured</h3>
      <p className="mb-4 max-w-md text-sm text-[#7A7A80]">
        Optional local or remote Model Context Protocol servers give bots extra tools, without
        Composio. Plugins still use Composio when a key is configured.
      </p>
      {onAddServer ? (
        <Button type="button" variant="pill" size="sm" onClick={onAddServer}>
          Add your first server
        </Button>
      ) : null}
    </div>
  );
}

function ServerCard({
  server,
  status,
  canManage,
  onEdit,
  onDelete,
  onToggle,
  disabled,
}: {
  server: McpServerPublic;
  status?: McpServerStatus;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  disabled: boolean;
}) {
  const isDisabled = Boolean(server.disabled);
  const badge = isDisabled ? "disabled" : (status?.status ?? "error");
  return (
    <div className="rounded-xl border border-[#26262A] bg-[#141416] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h3 className="truncate text-base font-medium text-[#F1F1F2]">{server.name}</h3>
            <StatusBadge status={badge} />
          </div>
          <p className="mt-1 truncate text-sm text-[#7A7A80]">
            {server.type === "stdio"
              ? `${server.command ?? ""} ${(server.args ?? []).join(" ")}`.trim()
              : (server.url ?? server.type)}
          </p>
          {status?.status === "connected" && status.toolCount > 0 ? (
            <p className="mt-1 text-xs text-[#6C6C70]">{status.toolCount} tools</p>
          ) : null}
          {status?.error ? <p className="mt-1 text-xs text-[#C94244]">{status.error}</p> : null}
        </div>
        {canManage ? (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onToggle}
              disabled={disabled}
              className="rounded-lg px-3 py-1.5 text-sm text-[#C9C9CE] hover:bg-[#1C1C1E] disabled:opacity-50"
            >
              {isDisabled ? "Enable" : "Disable"}
            </button>
            <button
              type="button"
              onClick={onEdit}
              disabled={disabled}
              className="rounded-lg px-3 py-1.5 text-sm text-[#C9C9CE] hover:bg-[#1C1C1E] disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={disabled}
              className="rounded-lg px-3 py-1.5 text-sm text-[#C94244] hover:bg-[#1C1C1E] disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: McpServerStatus["status"] }) {
  const label = status === "connected" ? "connected" : status === "disabled" ? "disabled" : "error";
  const color = status === "connected" ? "#4ECB71" : status === "disabled" ? "#85858A" : "#C94244";
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[12px]"
      style={{ color, background: `${color}22` }}
    >
      {label}
    </span>
  );
}

function McpServerEditor({
  server,
  existingNames,
  onSave,
  onCancel,
  saving,
}: {
  server?: McpServerPublic;
  existingNames: string[];
  onSave: (server: {
    name: string;
    type: McpServerPublic["type"];
    command?: string;
    args?: string[];
    url?: string;
    disabled?: boolean;
    headers?: Record<string, string>;
    env?: Record<string, string>;
  }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(server?.name ?? "");
  const [type, setType] = useState<McpServerPublic["type"]>(server?.type ?? "http");
  const [command, setCommand] = useState(server?.command ?? "");
  const [args, setArgs] = useState((server?.args ?? []).join(" "));
  const [url, setUrl] = useState(server?.url ?? "");
  const [env, setEnv] = useState("");
  const [headers, setHeaders] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
      setError("Use letters, numbers, dots, dashes, or underscores for the name.");
      return;
    }
    if (existingNames.includes(trimmed) && trimmed !== server?.name) {
      setError("That server name is already in use.");
      return;
    }
    if (type === "stdio" && !command.trim()) {
      setError("stdio servers need a command.");
      return;
    }
    if (type !== "stdio" && !url.trim()) {
      setError("HTTP and SSE servers need a URL.");
      return;
    }

    const envObj = parsePairs(env, "=");
    const headersObj = parsePairs(headers, ":");
    onSave({
      name: trimmed,
      type,
      disabled: server?.disabled,
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
    });
  }

  return (
    <form onSubmit={handleSubmit} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-[#F1F1F2]">
          {server ? "Edit server" : "Add server"}
        </h3>
        <p className="mt-1 text-sm text-[#7A7A80]">Configure a Model Context Protocol server.</p>
      </div>
      {error ? (
        <div className="mb-4 rounded-lg border border-[#C94244]/20 bg-[#C94244]/10 px-4 py-3">
          <p className="text-sm text-[#C94244]">{error}</p>
        </div>
      ) : null}
      <label className="block text-sm text-[#85858A]">
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 text-[#ECECEE]"
          required
        />
      </label>
      <div className="mt-5 text-sm text-[#85858A]">
        Transport
        <div className="mt-2 grid grid-cols-3 gap-3">
          {(["http", "sse", "stdio"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setType(option)}
              className={`rounded-lg border px-4 py-3 text-sm ${
                type === option
                  ? "border-[#F1F1F2] text-[#F1F1F2]"
                  : "border-[#26262A] text-[#7A7A80]"
              }`}
            >
              {option.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {type === "stdio" ? (
        <>
          <label className="mt-5 block text-sm text-[#85858A]">
            Command
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 font-mono text-[#ECECEE]"
            />
          </label>
          <label className="mt-5 block text-sm text-[#85858A]">
            Arguments
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 font-mono text-[#ECECEE]"
            />
          </label>
          <label className="mt-5 block text-sm text-[#85858A]">
            Environment variables
            <textarea
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              rows={3}
              placeholder={server?.hasEnv ? "Leave blank to keep the stored values" : "KEY=value"}
              className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 font-mono text-[#ECECEE]"
            />
          </label>
        </>
      ) : (
        <>
          <label className="mt-5 block text-sm text-[#85858A]">
            URL
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://127.0.0.1:3000/mcp"
              className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 font-mono text-[#ECECEE]"
            />
          </label>
          <label className="mt-5 block text-sm text-[#85858A]">
            Headers
            <textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              rows={3}
              placeholder={
                server?.hasHeaders
                  ? "Leave blank to keep the stored values"
                  : "Authorization: Bearer token"
              }
              className="mt-2 w-full rounded-[11px] border border-[#26262A] bg-transparent px-3.5 py-3 font-mono text-[#ECECEE]"
            />
          </label>
        </>
      )}
      <div className="mt-6 flex gap-3">
        <Button type="submit" variant="pill" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save server"}
        </Button>
        <button type="button" onClick={onCancel} className="text-sm text-[#7A7A80]">
          Cancel
        </button>
      </div>
    </form>
  );
}

function parsePairs(text: string, separator: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf(separator);
    if (index <= 0) continue;
    result[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return result;
}
