import type { ConnectionCatalogItem, McpServerConfig } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useEffect, useMemo, useState } from "react";
import { McpServerForm } from "../components/McpServerForm";
import { rpc } from "../lib/rpc";

let cachedCatalog: ConnectionCatalogItem[] = [];

function markConnected(items: ConnectionCatalogItem[], slug: string, connected: boolean) {
  return items.map((entry) => (entry.slug === slug ? { ...entry, connected } : entry));
}

type Tab = "composio" | "mcp";

export function PluginsOverlay({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("mcp");
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<ConnectionCatalogItem[]>(cachedCatalog);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cachedCatalog.length === 0);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [mcpLoading, setMcpLoading] = useState(true);
  const [editingMcp, setEditingMcp] = useState<number | "new" | null>(null);
  const [mcpSaving, setMcpSaving] = useState(false);

  async function refresh() {
    const items = await rpc.connections.catalog({});
    cachedCatalog = items;
    setCatalog(items);
    return items;
  }

  async function loadMcpServers() {
    try {
      const result = await rpc.mcp.list();
      setMcpServers(result.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load MCP servers");
    } finally {
      setMcpLoading(false);
    }
  }

  async function saveMcpServers(servers: McpServerConfig[]) {
    setMcpSaving(true);
    setError(null);
    try {
      await rpc.mcp.update({ servers });
      setMcpServers(servers);
      setEditingMcp(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save MCP servers");
    } finally {
      setMcpSaving(false);
    }
  }

  async function deleteMcpServer(index: number) {
    const newServers = mcpServers.filter((_, i) => i !== index);
    await saveMcpServers(newServers);
  }

  async function toggleMcpServer(index: number) {
    const newServers = mcpServers.map((s, i) =>
      i === index ? { ...s, disabled: !s.disabled } : s,
    );
    await saveMcpServers(newServers);
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load catalog"),
      )
      .finally(() => setLoading(false));
    void loadMcpServers();
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return catalog;
    return catalog.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) || item.slug.toLowerCase().includes(needle),
    );
  }, [catalog, query]);

  function setItemConnected(slug: string, connected: boolean) {
    cachedCatalog = markConnected(cachedCatalog, slug, connected);
    setCatalog((prev) => markConnected(prev, slug, connected));
  }

  async function connect(item: ConnectionCatalogItem) {
    setError(null);
    setPending(item.slug);
    try {
      const started = await rpc.connections.begin({ provider: item.slug, displayName: item.name });
      if (started.authorizationUrl)
        window.open(started.authorizationUrl, "_blank", "noopener,noreferrer");
      if (item.noAuth && !started.authorizationUrl) {
        setItemConnected(item.slug, true);
        return;
      }
      for (let i = 0; i < 45; i += 1) {
        const row = await rpc.connections
          .complete({ connectionId: started.connectionId })
          .catch(() => undefined);
        if (row?.status === "connected") {
          setItemConnected(item.slug, true);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
    } finally {
      setPending(null);
    }
  }

  async function revoke(item: ConnectionCatalogItem) {
    setError(null);
    setPending(item.slug);
    try {
      const rows = await rpc.connections.list();
      const row = rows.find(
        (entry) => entry.provider === item.slug && entry.status === "connected",
      );
      if (!row) {
        setError(`No connection record found for ${item.name}.`);
        return;
      }
      await rpc.connections.revoke({ connectionId: row.id });
      setItemConnected(item.slug, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke connection");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(4,4,5,.62)] p-10">
      <div className="flex h-[760px] w-[1080px] max-w-full flex-col overflow-hidden rounded-[26px] border border-[#232326] bg-[#141416] shadow-[0_40px_90px_rgba(0,0,0,.55)]">
        <div className="flex items-start justify-between px-8 pt-7">
          <div>
            <div className="text-2xl font-medium text-[#F1F1F2]">Plugins</div>
            <p className="mt-1 text-[13.5px] text-[#7A7A80]">
              {tab === "composio"
                ? loading
                  ? "Loading catalog…"
                  : `${catalog.length} apps`
                : mcpLoading
                  ? "Loading MCP servers…"
                  : `${mcpServers.length} servers`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close plugins"
            onClick={onClose}
            className="text-[#85858A]"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-2 px-8 pt-4 border-b border-[#26262A]">
          <button
            type="button"
            onClick={() => setTab("mcp")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === "mcp"
                ? "text-[#F1F1F2] border-b-2 border-[#F1F1F2]"
                : "text-[#7A7A80] hover:text-[#ECECEE]"
            }`}
          >
            MCP Servers
          </button>
          <button
            type="button"
            onClick={() => setTab("composio")}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === "composio"
                ? "text-[#F1F1F2] border-b-2 border-[#F1F1F2]"
                : "text-[#7A7A80] hover:text-[#ECECEE]"
            }`}
          >
            Composio
          </button>
        </div>

        {tab === "mcp" ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            {editingMcp !== null ? (
              <div className="flex-1 overflow-y-auto px-8 py-6 rk-scroll">
                <McpServerForm
                  server={editingMcp === "new" ? undefined : mcpServers[editingMcp]}
                  onSave={(server) => {
                    const newServers =
                      editingMcp === "new"
                        ? [...mcpServers, server]
                        : mcpServers.map((s, i) => (i === editingMcp ? server : s));
                    void saveMcpServers(newServers);
                  }}
                  onCancel={() => setEditingMcp(null)}
                />
              </div>
            ) : (
              <>
                <div className="px-8 pt-4 flex gap-2">
                  <Button
                    type="button"
                    variant="pill"
                    size="sm"
                    onClick={() => setEditingMcp("new")}
                    disabled={mcpSaving}
                  >
                    Add Server
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto px-8 py-6 rk-scroll">
                  {error ? <p className="mb-4 text-sm text-[#C94244]">{error}</p> : null}
                  {!mcpLoading && mcpServers.length === 0 ? (
                    <p className="text-[#6C6C70]">
                      No MCP servers configured. Add a server to get started.
                    </p>
                  ) : null}
                  {mcpServers.map((server, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-4 rounded-[13px] px-3 py-2.5 border border-[#26262A] mb-2"
                    >
                      <div className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-[#2C2C30] font-semibold text-sm">
                        {server.type === "stdio" ? "📟" : "🌐"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[15.5px] font-medium text-[#ECECEE] flex items-center gap-2">
                          {server.name}
                          {server.disabled && (
                            <span className="text-xs text-[#7A7A80]">(disabled)</span>
                          )}
                        </div>
                        <div className="text-[13.5px] text-[#7A7A80]">
                          {server.type === "stdio"
                            ? `${server.command} ${(server.args ?? []).join(" ")}`
                            : server.url}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="pill"
                          size="sm"
                          disabled={mcpSaving}
                          onClick={() => void toggleMcpServer(index)}
                        >
                          {server.disabled ? "Enable" : "Disable"}
                        </Button>
                        <Button
                          type="button"
                          variant="pill"
                          size="sm"
                          disabled={mcpSaving}
                          onClick={() => setEditingMcp(index)}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="pill"
                          size="sm"
                          disabled={mcpSaving}
                          onClick={() => void deleteMcpServer(index)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="px-8 pt-4">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search apps"
                className="w-full rounded-[13px] border border-[#26262A] bg-[#101012] px-4 py-3 text-[15px] text-[#ECECEE] outline-none"
              />
            </div>
            <div className="rk-scroll flex-1 overflow-y-auto px-8 py-6">
              {error ? <p className="mb-4 text-sm text-[#C94244]">{error}</p> : null}
              {!loading && catalog.length === 0 ? (
                <p className="text-[#6C6C70]">Composio is not configured on this deployment.</p>
              ) : null}
              {visible.map((item) => (
                <div key={item.slug} className="flex items-center gap-4 rounded-[13px] px-3 py-2.5">
                  {item.logo ? (
                    <img
                      src={item.logo}
                      alt=""
                      className="h-[42px] w-[42px] rounded-xl bg-[#2C2C30] object-contain"
                    />
                  ) : (
                    <div className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-[#2C2C30] font-semibold">
                      {item.name[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[15.5px] font-medium text-[#ECECEE]">{item.name}</div>
                    <div className="text-[13.5px] text-[#7A7A80]">
                      {item.slug}
                      {item.noAuth ? " · no auth" : ""}
                    </div>
                  </div>
                  {item.connected ? (
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={pending === item.slug}
                      onClick={() => void revoke(item)}
                    >
                      {pending === item.slug ? "Revoking…" : "Revoke"}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="pill"
                      size="sm"
                      disabled={pending === item.slug}
                      onClick={() => void connect(item)}
                    >
                      {pending === item.slug ? "Connecting…" : "Connect"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
