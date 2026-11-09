# LatticeAG Gateway integration

VisBoard can be attached to LatticeAG Gateway as a project context source and, when explicitly enabled, as a destination for reviewed notes. Gateway reads the configured project context and boards; its note-create operation requires operator review.

## Prepare VisBoard

1. Start VisBoard and create the initial workspace with `visboard auth bootstrap --name "Acme"`.
2. Create or choose a project and a scoped agent key:

   ```sh
   visboard project create --name "Platform" --slug platform --workspace acme
   visboard agent create --name "LatticeAG Gateway" --scopes read --project platform --workspace acme
   ```

   Save the one-time agent token shown by the CLI. Add `write:notes` only if Gateway should be allowed to create notes. The `read` scope supports context and board reads; `write:notes` is the separate permission for note creation. Do not use an admin key for this integration.

3. Record the workspace ID (`ws_…`), project ID (`prj_…`), and the agent key. Gateway needs IDs for binding, even though the context route itself resolves workspace and project slugs.

## Configure Gateway

Create a VisBoard product instance in Gateway with:

| Setting | Value |
| --- | --- |
| `base_url` | VisBoard API origin, for example `http://127.0.0.1:8080` or `https://visboard.example`; omit `/v1` and `/v2` |
| `workspace_id` | The bound `ws_…` workspace ID |
| `project_id` | The bound `prj_…` project ID |
| `api_token_ref` | Gateway secret-store reference containing the `vb_agent_…` key |

Gateway checks `GET /health` without credentials when attaching. The read operations then use the configured key against `/v1/workspaces/{workspace-slug}/projects/{project-slug}/context` and `/v2/workspaces/{workspace-id}/boards`. A selected board must belong to the bound project. Note creation uses the project's `/v1/.../notes` endpoint and requires `write:notes`.

## Verify the attachment

In Gateway, run the VisBoard integration health check and read the configured project's context. The health result checks API reachability only; the context and board reads verify that the stored credential and workspace/project binding work. If note creation is enabled, use a reviewed note operation and confirm the result in VisBoard before retrying an operation whose response was lost.

For local development, the API origin is `http://localhost:8080`; the Compose stack publishes the same port. See the [install guide](./install.md) for starting VisBoard.
