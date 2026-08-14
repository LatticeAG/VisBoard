# @visboard/mcp

MCP server exposing [VisBoard](https://github.com/LatticeAG/visboard) to Cursor, Claude, and other Model Context Protocol clients.

## Tools

| Tool | Description |
|------|-------------|
| `list_workspaces` | List accessible workspaces |
| `list_projects` | List projects in a workspace |
| `get_context` | Fetch agent-optimized project context |
| `get_agents_md` | Fetch generated AGENTS.md markdown |
| `list_notes` | List notes in a project |
| `get_note` | Get a note by slug or id |
| `upsert_note` | Create or update a note by slug |
| `list_checklists` | List checklists and items |
| `set_checklist_item` | Toggle or set checklist item done state |
| `append_event` | Append an activity stream event |
| `upload_file` | Upload a file (base64 content) |
| `list_agents` | List workspace agents |
| `create_agent` | Create an agent (returns API key once) |

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VISBOARD_TOKEN` | Yes | (none) | Personal access token or agent API key |
| `VISBOARD_API_URL` | No | `http://localhost:8080/v1` | VisBoard API base URL |
| `VISBOARD_BASE_URL` | No | (alias of `VISBOARD_API_URL`) | Accepted for older docs |

## Cursor setup

Add to your Cursor MCP config (`~/.cursor/mcp.json` or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "visboard": {
      "command": "node",
      "args": ["packages/mcp/dist/index.js"],
      "env": {
        "VISBOARD_API_URL": "http://localhost:8080/v1",
        "VISBOARD_TOKEN": "vb_pat_..."
      }
    }
  }
}
```

For local development in this monorepo, point `command` at the built binary:

```json
{
  "mcpServers": {
    "visboard": {
      "command": "node",
      "args": ["/path/to/visboard/packages/mcp/dist/index.js"],
      "env": {
        "VISBOARD_API_URL": "http://localhost:8080/v1",
        "VISBOARD_TOKEN": "vb_pat_..."
      }
    }
  }
}
```

## Development

```bash
pnpm --filter @visboard/mcp build
VISBOARD_TOKEN=vb_pat_... node packages/mcp/dist/index.js
```

The server uses stdio transport and communicates over stdin/stdout.
