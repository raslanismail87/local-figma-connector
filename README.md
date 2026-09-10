# Local Figma connector for Codex

Free and open source under the [MIT license](LICENSE).

A local TypeScript MCP server and custom Figma Design plugin. Inspect selections and node trees, create or update frames/text/shapes/components, and export PNG previews or SVG files. There is no hosted backend, connector subscription, REST API token, or dependency on Figma's official MCP service. Normal Codex usage remains separate. The connector works with any editable Figma Design file in which you run its plugin; it is not tied to one project, account, or design system.

**Local development plugins require Figma desktop.** The free Starter plan supports this workflow. Chrome is an optional browser-control adapter; this unpublished plugin cannot be imported into Chrome using Figma's supported local development workflow. See [verified platform references](docs/official-references.md) for Community review restrictions and browser networking constraints.

## Quick start

Requirements: Node.js 20.19 or newer, npm, Figma desktop, and an editable Figma Design file. The complete workflow has been tested on macOS. Figma Desktop is available for macOS and Windows; Windows setup has not been live validated here. Linux can run the server and browser checks, but does not provide the supported local Figma Desktop workflow.

```sh
git clone https://github.com/raslanismail87/local-figma-connector.git
cd local-figma-connector
npm ci
npm run build
npm run setup
npm run bridge
```

Keep the bridge terminal running. It listens only on `127.0.0.1:3845`. Setup creates a private token and later a mutation journal under `~/.local/share/figma-connector/`; credentials never belong in the repository or Codex conversation. MCP clients connect to this shared bridge, so multiple Codex processes do not fight over the port.

### Import and pair in Figma desktop

1. Install [Figma desktop](https://www.figma.com/downloads/) if needed, sign in, and open an editable Figma Design file. For a first validation, create a disposable file in Drafts named `Codex Connector Smoke Test`.
2. In the editor, use **Plugins → Development → Import new plugin from manifest** and choose `dist/plugin/manifest.json` inside your checkout.
3. Run **Plugins → Development → Local Figma Connector**. Keep the plugin panel open.
4. In another terminal in this project, run `npm run pair`. This copies the pairing key without printing it using the available system clipboard helper. Paste it into the plugin's password field and click **Connect**. If no helper is available, follow the local manual-copy guidance; do not share the key in chat.
5. The panel should say **Connected · ready for Codex**. For the live smoke test, draw and select a small rectangle for the initial read/export check.

The built manifest imports without a publishing ID in the tested Figma Desktop 126.8.18. Its development WebSocket address is `ws://localhost:3845`; retain that hostname in both the manifest and plugin UI. The bridge itself binds only to `127.0.0.1`.

`npm run pair` uses `pbcopy` on macOS, PowerShell on Windows, or `wl-copy`/`xclip`/`xsel` on Linux. Install the appropriate Linux utility or use the private token file manually if unavailable. It places a secret on the clipboard; replace the clipboard contents after pairing. The plugin keeps the key only in memory while connected and clears it on Disconnect or pairing rejection. It does not use URLs or client storage for credentials.

### Connect Codex

Generate configuration using your current Node executable and checkout path:

```sh
npm run --silent config:codex
```

Copy the generated TOML table into `~/.codex/config.toml`, preserving existing settings. The generator prints configuration only; it does not modify Codex settings. An annotated [configuration template](docs/codex-mcp.toml) is also available. Reload the Codex MCP connection or start a new Codex session after registration. The bridge must be running separately. If you move the checkout or change Node installations, regenerate the configuration.

The official [Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) documents stdio registration and `config.toml`. This is a custom local server; OAuth and Figma personal access tokens are unnecessary.

## Use it

Start with `figma_sessions`. Each plugin run exposes its document, page, latest selection and a session ID. If several plugins are connected, pass the intended `sessionId` on every document call. Session IDs change after reconnection; list them again. `figma_selection` queries fresh selection information. Document context includes names and page/node IDs; `fileKey` is always `null` because the public Plugin API does not expose it.

| Tool | Purpose |
| --- | --- |
| `figma_sessions` | List connected plugin instances and document context |
| `figma_selection` | Read current document/page and selected node identities |
| `figma_read_nodes` | Read selected or explicit IDs with bounded hierarchy and properties |
| `figma_export_nodes` | PNG image content or SVG file, local path and metadata |
| `figma_create_node` | Create one typed node, optionally under a parent |
| `figma_update_node` | Update supported properties on one typed node |
| `figma_request_status` | Inspect a prior mutation's durable result or uncertain status |

Example prompts for Codex:

- “List the connected local Figma sessions and read the selection in my smoke-test file.”
- “In that session, create a 400 by 240 frame with a vertical Auto Layout, 24px padding and 12px spacing. Add an Inter Regular text layer saying Hello from Codex.”
- “Update that text to Connected locally, then export the frame as PNG and show me the preview.”

Tool argument examples are in [usage.md](docs/usage.md). Mutation calls require a fresh UUID `mutationId` for each new intended change. The journal prevents dispatching the same ID twice, including across bridge restarts. Reads and exports need no mutation ID.

### Supported edits

Create/update frames, text, rectangles, ellipses, lines, polygons, stars and components. Properties include name, position, dimensions, rotation, visibility, opacity, solid RGBA fills and strokes, stroke weight, corner radius where supported, text content/font/size/alignment/line height/letter spacing, clipping, Auto Layout direction/padding/spacing/alignment/sizing, and child layout sizing. Coordinates and sizes use Figma pixels; color channels are numbers from 0 to 1.

Font families/styles must exist in the Figma editor. New text defaults to Inter Regular. Existing mixed fonts are loaded before applicable edits. Unsupported node/property combinations fail explicitly. This connector does not expose arbitrary JavaScript, vector path editing, gradients/image-fill creation, component variants/instances, prototype interactions, variables, styles, deletion, page creation, rich-text range editing, or bulk transactions. Reads can inspect a wider variety of existing scene nodes.

## Optional Chrome control

Install Chrome normally. The launcher and browser smoke scripts detect common Chrome/Chromium locations on macOS, Windows and Linux; set `CHROME_EXECUTABLE` to an exact executable path if needed. Run `npm run chrome:launch` to start a dedicated debugging profile; sign into Figma normally in that separate profile. The launcher uses loopback CDP and a non-default profile, as required by current Chrome. It does not attach to or copy your everyday profile.

Enable the optional adapter by adding this environment table to the MCP configuration, then reload it:

```toml
[mcp_servers.local_figma.env]
FIGMA_CONNECTOR_CDP_URL = "http://127.0.0.1:9222"
```

Chrome tools list/open/select/navigate tabs, inspect accessibility snapshots, operate visible controls by selector or role/name, use coordinates and keyboard shortcuts, and capture PNG screenshots. The adapter does not expose browser JavaScript evaluation. Use the Plugin API tools for structured Figma edits. Plugin functionality does not require Chrome.

This repository supplies a development plugin. Figma's current Community review guidelines say it generally does not approve plugins providing programmatic AI access outside its official MCP server, which matches this connector's design. Community publication should therefore not be treated as an available distribution route without explicit acceptance from Figma or a policy change. Browser-hosted localhost networking is separately unverified. [Details and official sources](docs/official-references.md).

## Validation

```sh
npm run check
npm run smoke:chrome
npm run smoke:ui
npm run smoke:live -- --document 'Codex Connector Smoke Test'
```

`check` typechecks, exercises protocol/bridge/MCP and mocked Plugin API behaviors, and builds the actual bundles. `smoke:chrome` uses a disposable Chrome profile and local fixture; it does not establish Figma login or published-plugin compatibility. `smoke:ui` exercises the compiled pairing UI with an opaque-origin browser iframe, a simulated Figma parent and a real bridge. `smoke:live` uses the built stdio MCP server against a **real paired desktop plugin**. It first reads/exports the selected rectangle, creates a frame and text, updates both, reads back values, and exports PNG/SVG. It stops on the first error and never retries a mutation. Use it only with the named disposable file. Multiple sessions require `--session SESSION_ID`.

Live import, pairing, selection/node reads, frame/text creation and updates, and PNG/SVG export passed in Figma Desktop 126.8.18. The exercised workspace was Professional; Starter compatibility is based on Figma's documented plugin support. See [validation.md](docs/validation.md) for evidence and coverage limits.

## Reliability and recovery

- The bridge uses a random 256-bit shared pairing key, exact loopback binding, Host/origin filtering, WebSocket handshake authentication, bounded messages, schema validation, request IDs and heartbeats. Only pair trusted local plugin code. An authenticated process holding the key can control connected files.
- Commands expire after 30 seconds; the plugin checks the deadline before starting work. A 30-second server timeout cannot cancel an already-running Figma operation. The result is **OUTCOME_UNCERTAIN**, including the request ID. Never automatically retry it with a fresh mutation ID.
- Call `figma_request_status` with that ID. Late replies on the same connection can complete the recorded result. After a disconnect the result may remain uncertain; reconnect, list sessions, inspect affected nodes or the page manually, and decide whether another edit is appropriate.
- A pending mutation blocks further mutations in the same session until its reply or a disconnect. Read requests remain possible. Reconnection restores the connection only; it never resends design commands.
- The private journal retains up to 10,000 mutation IDs, with the command fingerprint, session, outcome and inspection context (document/page, target or parent ID, requested node type/name). It survives ordinary restarts; it is not a guarantee against OS/disk loss, manual deletion, or copying/replacing the state directory. Never delete it to retry an uncertain edit. New plugin runtimes also forget their in-memory duplicate guard, so retain the bridge journal.
- Validate and load fonts before writes; Figma operations are not transactions. Runtime failures can leave partially applied properties. Errors report affected node IDs and applied properties when available. Inspect the result and use Figma's normal Undo shortcut where appropriate. Successful changes and partial changes establish `commitUndo()` boundaries; the connector never invokes a global undo automatically.
- Exported design assets are private local files under `~/.local/share/figma-connector/exports/`. They persist for previews and can be deleted when no longer needed. The mutation journal may contain design metadata, but never credentials.

If pairing fails, check the key, running bridge, exact port and manifest. Closing the plugin disconnects it; reopen, run `npm run pair` and reconnect. If the port is in use, stop the earlier connector bridge instead of starting another. `FIGMA_CONNECTOR_STATE_DIR` selects another private state directory. Changing `FIGMA_CONNECTOR_PORT` requires changing both the URL in `plugin/ui.ts` and `devAllowedDomains` in `plugin/manifest.json`, rebuilding, and using the same value for bridge and MCP.

## Source layout

`src/protocol.ts` owns validated contracts. `src/bridge/` owns authentication, sessions, correlation and mutation history. `src/mcp/` maps focused tools to the bridge and writes previews. `plugin/` owns Figma document operations and the small connection UI. `src/browser/` owns optional Chrome automation. `scripts/` owns builds, startup helpers and repeatable smoke checks. Generated plugin assets are in `dist/plugin/`.

## Contributing and license

MIT licensed; see [LICENSE](LICENSE). Start with [CONTRIBUTING.md](CONTRIBUTING.md) for development and validation, [SECURITY.md](SECURITY.md) for the trust boundary and reporting guidance, and [architecture and lessons learned](docs/architecture.md) for decisions discovered through live Figma testing. [CHANGELOG.md](CHANGELOG.md) records the initial release scope.
