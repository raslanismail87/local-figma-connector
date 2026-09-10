# Architecture and lessons learned

The connector is a reusable local integration, not a script for one document. Its intentionally narrow edit contract makes tool behavior inspectable. A connected plugin grants access to its live Figma file; the server does not enumerate an account or fetch remote files by key.

## Data flow

```text
Codex / stdio MCP client
        │ typed tool calls
        ▼
MCP server ── authenticated HTTP ──► localhost bridge
                                         │ authenticated WebSocket
                                         ▼
                                  Figma plugin UI
                                         │ validated messages
                                         ▼
                                  Figma Plugin API
```

The optional Chrome adapter is separate: MCP tools attach to a dedicated browser through loopback CDP. Browser access is not the document-edit transport.

`src/protocol.ts` defines the validated wire contract. `src/bridge/` owns authentication, session routing, correlation and durable mutation results. `src/mcp/` translates tool calls and persists exported assets. `plugin/` owns document reads, edits, exports and pairing. `src/browser/` owns optional browser interaction. Dependencies flow through explicit command/result contracts rather than arbitrary code execution.

## What live testing taught us

These observations came from Figma Desktop 126.8.18. They are compatibility evidence for that runtime, not promises about all future versions.

| Observation | Implementation response |
| --- | --- |
| The manifest rejected `ws://127.0.0.1:3845` but accepted `ws://localhost:3845`. | Keep the exact localhost WebSocket URL in the manifest and UI. The server still binds to numeric IPv4 loopback; HTTP RPC accepts only its numeric host. |
| Figma's sandbox scanner rejected `import()` text inside a bundled dependency comment. | Remove comments and whitespace from production bundles and test the compiled output against known scanner restrictions. A successful TypeScript build alone is insufficient. |
| `figma.fileKey` required a private Plugin API. | Return `fileKey: null` without reading the private property. Address documents through active sessions. |
| The real UI iframe lacked `crypto.randomUUID`. | Generate UUID v4 identifiers with `crypto.getRandomValues`. |
| Host messages arrived from the top window at a Figma HTTPS origin, not only the immediate parent. | Accept the trusted parent channel and top-window messages from exact Figma origins; retain schema validation and request correlation. |
| Embedding bundled JavaScript with a string replacement expanded replacement tokens inside the bundle. | Use a replacement callback and parse the embedded script during the build. |
| A sandboxed iframe could not rely on form submission for pairing. | Handle Connect clicks and Enter explicitly; validate the compiled UI in an opaque-origin iframe. |

Mocked API tests, compiled-bundle checks, browser UI tests and a real desktop smoke each exposed different failures. Keep these layers distinct when describing coverage. The original Starter-plan requirement is supported by platform documentation; the live account used for testing was Professional. See [validation](validation.md) and [platform references](official-references.md).

## Mutation uncertainty is a first-class result

A timeout does not prove an edit failed. An operation may have reached Figma before the bridge lost the response, and Figma property writes are not transactions.

Each intended mutation carries a UUID. The bridge records its fingerprint before dispatch and persists the outcome. Reusing the same UUID with the same arguments retrieves the known result instead of dispatching again; conflicting arguments are rejected. Pending operations become uncertain after a bridge restart. Reconnect restores transport only and never replays commands.

On `OUTCOME_UNCERTAIN`, inspect `figma_request_status` and the affected document before deciding on another edit. Partial errors include affected nodes and applied properties when available. The plugin creates Undo boundaries but never invokes a global undo on the user's behalf. Retain the journal: duplicate protection cannot survive its deletion or replacement.

## Troubleshooting

- **No sessions:** keep the plugin panel open, start the bridge, pair with the same state directory's token, then list sessions again.
- **Manifest import rejected:** import the built `dist/plugin/manifest.json`, preserve the localhost URL, and rebuild after source changes.
- **Panel fails before pairing:** rebuild and inspect the plugin console. Source tests cannot establish sandbox compatibility; run compiled-bundle and UI checks.
- **Connection refused or port occupied:** ensure one bridge owns the configured port. If changing the port, update both plugin endpoint declarations and bridge/MCP configuration.
- **Old session ID:** reconnect creates a new session. List sessions again and explicitly choose the intended file when several are connected.
- **Fonts or unsupported edits:** use fonts available in the editor and the supported property contract. No fallback to arbitrary JavaScript is provided.
- **Uncertain edit:** stop automatic mutation retries and inspect the durable status and document.

The plugin must stay open. Exported files, browser profiles and the mutation journal live outside source control and can contain private design data.

## Remembered pairing

Persistence is opt-in and independent of document commands. The UI sends strict, UUID-correlated load/save/forget messages to a serialized `figma.clientStorage` adapter. Separate UI revisions prevent late responses from overwriting manual input or undoing a newer preference. Only successful authentication triggers a save. Forget clears memory and disconnects before requesting deletion; failures are visible and can be retried. Reopening may restore the connection, but never replays document mutations.

Figma storage requires a stable plugin ID. The setup helper extracts only the ID from a Figma-generated manifest into ignored local configuration; the build retains the connector's own network and document permissions. Storage is local to the plugin ID, outside design files, and is not an encrypted vault. See the README for setup and removal behavior.
