# MCP Integration

Rakazo includes native support for the [Model Context Protocol (MCP)](https://modelcontextprotocol.io), allowing you to connect local and remote MCP servers without requiring Composio.

## Overview

MCP servers provide tools that your Rakazo bots can use. Common examples include:
- **Notion** – Read and write Notion pages
- **Filesystem** – Access local files
- **Memory** – Persistent key-value storage
- **Custom servers** – Build your own tools

## Configuration

MCP servers can be configured via:
1. **Web UI (registry)** – Plugins → Advanced → MCP servers (OAuth, per-bot assignment)
2. **Web UI (native / env)** – Plugins → MCP servers tab (deployment-level list)
3. **Database** – Stored in the deployment settings (managed via the native tab or API)
4. **Environment variable** (`MCP_SERVERS`) – JSON array of server configs
5. **Config file** (`MCP_CONFIG_PATH`) – Path to a JSON config file

Configurations from all sources are merged. Database and UI configurations are loaded alongside environment and file-based settings.

### Option 1: Web UI (Recommended)

The easiest way to configure MCP servers is through the web interface:

1. Open the Rakazo web or Electron app
2. Open **Plugins** in the sidebar
3. Open the **MCP servers** tab (Composio stays the default catalog)
4. Click **Add your first server** (or **Add another server**)
5. Fill in the server details:
   - **Name**: Unique identifier (e.g., "notion", "filesystem")
   - **Transport**: HTTP, SSE, or stdio
   - **URL** (HTTP/SSE) or **Command** (stdio)
   - **Optional**: Headers, environment variables, arguments
6. Save

Only the deployment owner can add, edit, disable, or delete servers. Other signed-in members can open the tab and see status. Saving reloads the API MCP client immediately. The worker picks up the new list on the next tool discovery. Env and file configs still apply on process start. List responses omit headers and env (`hasHeaders` / `hasEnv`).

### Option 2: Environment Variable

Set `MCP_SERVERS` to a JSON array of server configurations:

```bash
MCP_SERVERS='[
  {
    "name": "filesystem",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/documents"]
  },
  {
    "name": "notion",
    "type": "sse",
    "url": "http://localhost:3000",
    "headers": {
      "Authorization": "Bearer your-token"
    }
  }
]'
```

### Option 3: Config File

Create `mcp.json` (or any path) with:

```json
{
  "mcpServers": [
    {
      "name": "filesystem",
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/documents"],
      "env": {
        "HOME": "/home/user"
      }
    },
    {
      "name": "notion",
      "type": "sse",
      "url": "http://localhost:3000",
      "headers": {
        "Authorization": "Bearer your-token"
      }
    }
  ]
}
```

Then set:

```bash
MCP_CONFIG_PATH=/path/to/mcp.json
```

## Server Configuration Fields

All server configurations support these common fields:

- **name** (required) – Unique identifier for the server
- **type** (required) – Transport type: `"stdio"`, `"sse"`, or `"http"`
- **disabled** (optional) – Set to `true` to disable without deleting

### Stdio Servers

```json
{
  "name": "server-name",
  "type": "stdio",
  "command": "command-to-run",
  "args": ["arg1", "arg2"],
  "env": {
    "VAR": "value"
  }
}
```

- **name** (required) – Unique identifier for the server
- **type** – Must be `"stdio"`
- **command** (required) – Command to execute
- **args** (optional) – Command arguments
- **env** (optional) – Environment variables

### HTTP/SSE Servers

```json
{
  "name": "server-name",
  "type": "sse",
  "url": "http://localhost:3000",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

- **name** (required) – Unique identifier for the server
- **type** – Must be `"sse"`
- **url** (required) – Server URL
- **headers** (optional) – HTTP headers to send

## Tool Naming

MCP tools are namespaced by server name. For example:
- Server `"notion"` with tool `"create_page"` becomes `notion.create_page`
- Server `"filesystem"` with tool `"read_file"` becomes `filesystem.read_file`

Bots automatically discover and use these tools.

## API Management

For programmatic configuration, use the RPC API endpoints:

### List MCP Servers

```typescript
const servers = await rpc.mcp.list();
// Returns: { servers: McpServerPublic[] } — no headers or env values
```

### Update MCP Servers

```typescript
await rpc.mcp.update({
  servers: [
    {
      name: "notion",
      type: "http",
      url: "http://localhost:3000",
      headers: {
        "Authorization": "Bearer token"
      }
    }
  ]
});
// Returns: { ok: true }
```

**Note**: Only deployment owners can update MCP server configurations via the API.

## Example: Notion MCP Server

1. **Start a Notion MCP server** (example using a hypothetical server):

```bash
# Start the Notion MCP server on port 3000
NOTION_API_KEY=your-key npx notion-mcp-server --port 3000
```

2. **Configure Rakazo**:

```bash
MCP_SERVERS='[{"name":"notion","type":"sse","url":"http://localhost:3000"}]'
```

3. **Use in a bot**:

Your bot will now have access to tools like `notion.create_page`, `notion.search`, etc.

## Example: Local Filesystem Access

1. **Configure the filesystem server**:

```bash
MCP_SERVERS='[{"name":"fs","type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/home/user/docs"]}]'
```

2. **Use in a bot**:

Your bot can now use tools like `fs.read_file`, `fs.write_file`, `fs.list_directory`.

## Security Considerations

- **Secrets**: Store sensitive values (API keys, tokens) in environment variables or secure config files, not in chat logs
- **Filesystem access**: Limit stdio servers to specific directories
- **Network servers**: Ensure HTTP/SSE servers are authenticated and trusted
- **Sandboxing**: MCP servers run with the same permissions as Rakazo

## Troubleshooting

### Server won't connect

- Check logs for `[MCP]` prefixed messages
- Verify the command/URL is correct
- Ensure stdio commands are executable
- Check network connectivity for HTTP/SSE servers

### Tools not appearing

- Verify server configuration in logs
- Check `/health` endpoint for `"mcp": true`
- Ensure server names are unique
- After a UI save, check `mcp.status` without restarting the API. Restart the worker (or wait for the next discovery) after env/file changes

### Execution errors

- Review MCP server logs
- Check tool arguments match the server's schema
- Verify authentication headers for HTTP/SSE servers

## Status

Check MCP status via the health endpoint:

```bash
curl http://localhost:3100/health
```

Look for `"mcp": true` in the response.

## Comparison with Composio

| Feature | MCP (Native) | Composio |
|---------|-------------|----------|
| **Setup** | Local config | Cloud API key |
| **Privacy** | Fully local | Data sent to Composio |
| **Cost** | Free | Subscription |
| **Servers** | Any MCP server | Composio catalog |
| **Custom tools** | Full control | Limited |

Both can be used simultaneously – Composio for cloud integrations, MCP for local tools.

## References

- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Available MCP Servers](https://github.com/modelcontextprotocol/servers)
