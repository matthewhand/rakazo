import type { ConnectionCatalogItem } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useEffect, useMemo, useState } from "react";
import { McpSettingsPage } from "./McpSettingsPage";
import { rpc } from "../lib/rpc";

let cachedCatalog: ConnectionCatalogItem[] = [];

function markConnected(items: ConnectionCatalogItem[], slug: string, connected: boolean) {
  return items.map((entry) => (entry.slug === slug ? { ...entry, connected } : entry));
}

type View = "mcp" | "composio";

export function PluginsOverlay({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>("mcp");

  if (view === "mcp") {
    return <McpSettingsPage onClose={onClose} />;
  }

  return <ComposioView onClose={onClose} onBackToMcp={() => setView("mcp")} />;
}

function ComposioView({
  onClose,
  onBackToMcp,
}: {
  onClose: () => void;
  onBackToMcp: () => void;
}) {
  const [query, setQuery] = useState("");
  const [catalog, setCatalog] = useState<ConnectionCatalogItem[]>(cachedCatalog);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cachedCatalog.length === 0);

  async function refresh() {
    const items = await rpc.connections.catalog({});
    cachedCatalog = items;
    setCatalog(items);
    return items;
  }

  useEffect(() => {
    void refresh()
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load catalog"),
      )
      .finally(() => setLoading(false));
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
        <div className="flex items-start justify-between border-b border-[#26262A] px-8 pt-7 pb-4">
          <div>
            <button
              type="button"
              onClick={onBackToMcp}
              className="mb-2 text-sm text-[#7A7A80] hover:text-[#ECECEE] flex items-center gap-2"
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 8H3m0 0l4-4m-4 4l4 4" />
              </svg>
              Back to MCP Servers
            </button>
            <div className="text-2xl font-medium text-[#F1F1F2]">Composio Integrations</div>
            <p className="mt-1 text-[13.5px] text-[#7A7A80]">
              {loading ? "Loading catalog…" : `${catalog.length} apps available`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close plugins"
            onClick={onClose}
            className="text-[#85858A] hover:text-[#ECECEE]"
          >
            ✕
          </button>
        </div>

        <div className="px-8 pt-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps"
            className="w-full rounded-[13px] border border-[#26262A] bg-[#101012] px-4 py-3 text-[15px] text-[#ECECEE] outline-none focus:border-[#3C3C40]"
          />
        </div>

        <div className="rk-scroll flex-1 overflow-y-auto px-8 py-6">
          {error ? <p className="mb-4 text-sm text-[#C94244]">{error}</p> : null}
          {!loading && catalog.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-[#6C6C70] mb-4">Composio is not configured on this deployment.</p>
              <p className="text-sm text-[#7A7A80]">
                You can still use MCP servers for tool integrations without Composio.
              </p>
            </div>
          ) : null}
          {visible.map((item) => (
            <div key={item.slug} className="flex items-center gap-4 rounded-[13px] px-3 py-2.5 hover:bg-[#1C1C1E]">
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
      </div>
    </div>
  );
}
