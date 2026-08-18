# MCP integration

Optional native MCP sits beside destination tools and Composio. A Composio key is not required. This is not a plugin marketplace.

## Configuration

Operators attach servers with environment or a Cursor-shaped file. Empty config leaves MCP off.

### `MCP_SERVERS`

JSON array or Cursor-shaped object:

```bash
MCP_SERVERS='[
  {
    "name": "notes",
    "type": "sse",
    "url": "http://127.0.0.1:3000"
  }
]'
```

### `MCP_CONFIG_PATH`

Path to a JSON file. Either a `{ "mcpServers": { ... } }` object or an array of server entries.

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "mcp-server-filesystem"]
    }
  }
}
```

Env and file lists are merged. Duplicate names keep the first entry.

## Transports

- `stdio` — requires `command`. Optional `args` and `env`. The child inherits an allowlisted process environment only (no `DATABASE_URL` or `ENCRYPTION_KEY`).
- `http` — streamable HTTP. Requires `url`. Optional `headers`.
- `sse` — server-sent events. Requires `url`. Optional `headers`.

Disabled servers stay in the parsed config but do not connect and do not own tools.

## Tool names

Discovered tools are namespaced as `server.tool`. `notes.write` belongs to a server named `notes`. `notes.extra.write` belongs to `notes.extra`, not `notes`. Composio-style names such as `gmail.send` are not claimed unless an MCP server is actually named `gmail`.

## Health

`GET /health` reports `"mcp": true` only when at least one enabled server is configured. A failed server logs and stays disconnected; it does not take down the API or worker.

## Out of scope here

Owner settings UI, database-backed server lists, MCP OAuth, and sandbox-hosted stdio.
