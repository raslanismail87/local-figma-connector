# Validation record

Validation date: **2026-09-10**, macOS. This record covers the original live implementation and preparation for source distribution; it is not a claim that a fresh checkout is already installed or connected. Run the commands below to validate your environment. Generated reports, screenshots, credentials and exported design files are intentionally excluded from the repository.

## Source distribution checks

A clean export containing only the files intended for Git was installed with `npm ci` in a directory whose name contained spaces. `npm run check` passed all **53 tests**, typechecking and production builds. Generated Codex configuration parsed as TOML and resolved that export's actual Node executable and MCP entry point. The generated plugin's project and Zod license files matched their sources.

Five platform-helper tests cover executable discovery, paths with spaces, explicit overrides, clipboard fallback and secret-free error reporting. The final platform path correction passed these tests and typechecking. The updated Chrome smoke also passed all nine browser tools on macOS with Chrome 152.0.7977.83.

The Git candidate files were checked for the live pairing credential, personal installation paths and generated/private directories; none were included. CI YAML was parsed locally and configures Node 20.19, 22 and 24 on Linux, plus Node 24 on macOS and Windows. Hosted CI has not run because the repository has not been pushed. Windows and Linux helpers are implemented and have targeted simulated coverage; neither OS received live desktop validation.

## Automated checks

- `npm run check`: **48/48 tests passed at the original live-validation baseline**, TypeScript typechecking passed, and the actual bridge/MCP/plugin bundles built successfully.
- Real HTTP and WebSocket transport tests: authentication, Host/origin restrictions, schema violations, payload limits, session selection, response correlation, reconnection, disconnects, request deadlines and late responses.
- Persistent journal tests: uncertain status after restart, completed-result retrieval, duplicate suppression, conflicting argument rejection, corrupted journal refusal, and no dispatch on persistence failure.
- MCP checks: actual stdio subprocess handshake/tool listing/selection read, plus the PNG preview path through MCP → HTTP bridge → WebSocket simulated plugin peer → image content and saved PNG bytes.
- Mocked Plugin API tests: bounded reads/mixed typography, node resolution, export size limits, font loading before edits, expired preflight, unsupported node/property rejection, partial failure metadata, undo boundaries and mutation deduplication.

These tests simulate the Figma API or plugin peer. Separate live editor evidence follows below.

## Chrome

`npm run smoke:chrome` passed against installed **Google Chrome 152.0.7977.83**, connected using real CDP and a temporary dedicated profile. Tested the registered browser tools for tab discovery/open/selection/navigation, role and CSS targeting, coordinate clicks, typing, keyboard shortcuts, accessibility snapshots and PNG screenshots. Confirmed invalid URL rejection and uncertain-action timeout reporting.

Evidence: `artifacts/chrome-smoke/result.json` and `artifacts/chrome-smoke/browser-fixture.png`. The smoke uses a local fixture deliberately enabled only through an internal test option. Production navigation remains restricted to Figma HTTPS and `about:blank`.

This does not verify Figma login, Figma canvas controls, desktop/browser document synchronization, Community distribution or WebSocket networking in Figma's hosted Chrome iframe.

## Compiled pairing UI

`npm run smoke:ui` passed with the actual built UI JavaScript in a Chrome iframe using only `sandbox="allow-scripts"` and the production bridge origin policy. The parent emulates schema-valid Figma messages; the WebSocket bridge is real. Verified Enter-key pairing, invalid-token rejection, selection request forwarding, automatic bridge-restart reconnect, manual reconnect, disconnect cleanup, and absence of pairing keys from URLs, browser storage and parent messages.

This check found and drove fixes for two build/runtime defects: replacement-string expansion corrupting bundled JavaScript during HTML embedding, and the Connect action depending on form-submission permission. The build now parses its embedded script before delivery, and Connect works through explicit click/Enter handling.

Evidence: `artifacts/plugin-ui-smoke/result.json` and seven state screenshots. The 320×380 connected and long-error layouts were visually inspected and fit the panel. At 280px width, content has no horizontal overflow; the deliberately long error is vertically scrollable. No browser runtime errors occurred. This is still a simulated parent, **not the real Figma iframe**.

## Live Figma: passed

The built manifest was imported without a publishing ID into **Figma Desktop 126.8.18**, and Local Figma Connector was run and paired in the disposable Design file **Codex Connector Smoke Test**. The exercised workspace was **Professional**. Starter compatibility is supported by the official plugin documentation, but was not tested on a Starter account.

```sh
npm run smoke:live -- --document 'Codex Connector Smoke Test'
```

The command passed through the actual built stdio MCP server → authenticated HTTP bridge → WebSocket → Figma Plugin API. It read the current selection and initial selected rectangle, exported that rectangle as PNG, created an Auto Layout frame and text, updated both, read back the expected values, and exported the frame as PNG and SVG. The verified frame is named `Connector smoke verified`, measures 440×240, and contains `Connected locally` in Inter Regular at 28px. All four smoke mutations returned completed results; no mutation was retried.

The runner writes `artifacts/live-smoke-<timestamp>.json`, including arguments, request IDs, returned node properties and local export paths. Exports are saved under the private connector state directory. These files remain local because they can contain document content and identifying metadata.

The actual 440×240 PNG was visually inspected: the pale green frame and dark `Connected locally` text rendered correctly, with the text placed at the expected 24px inset.

After the original 48-test build and another passing compiled-UI smoke, actual Desktop Reconnect replaced the session while preserving the plugin instance, Disconnect removed it, and fresh pairing restored selection and node reads through the built stdio MCP server. The frame and text remained intact. Rebuilding a development plugin reloads its panel and requires pairing again; a bridge-only restart is handled by automatic reconnection.

Actual Desktop execution exposed and resolved compatibility issues that simulated peers could not establish:

- The manifest rejected the numeric-IP WebSocket URL and accepted `ws://localhost:3845`. The UI uses that exact endpoint; the server retains its numeric loopback binding and strict HTTP host policy.
- Figma's sandbox rejected `import()` text inside a dependency comment. Both production bundles now remove comments and whitespace during bundling, and compiled-bundle checks guard sandbox compatibility.
- Reading `figma.fileKey` requires a private Plugin API. Public document context now consistently returns `fileKey: null` without accessing that property.
- The actual UI iframe lacked `crypto.randomUUID`. Session UUIDs now use `crypto.getRandomValues`.
- Real document messages arrived from the top window at an exact Figma HTTPS origin. The UI accepts those host messages alongside the parent channel, while preserving schema validation and request correlation. Compiled-UI tests reject spoofed sources/origins and unrelated replies.

The smoke requires the document name to match and requires an explicit session when more than one plugin is paired. After any failure, inspect its report and the document before running it again.

## Remaining limitations

- Live coverage uses one document and one plugin session. Normal Undo, page changes and simultaneous live sessions are not established by the smoke report; automated tests cover the corresponding supported request and recovery behavior.
- The plugin must remain open. Sessions are live runtime connections, not a catalog of every Figma file.
- Supported edits are deliberately typed and limited; unsupported operations fail explicitly. Rich text ranges, vectors, component variants, image fills and other omitted APIs are outside this version.
- Browser support is complementary. A future published plugin would require Figma review plus separate Chrome iframe/networking tests under normal browser security settings.
- Mutation deduplication relies on retaining the private state directory and journal. It is not a distributed transaction or a power-loss guarantee. Figma can partially apply a multi-property edit.
- macOS is the exercised setup target. Cross-platform helper behavior is described in the README; Windows and Linux have not received the same live editor validation.

Platform claims and verification sources are in [official-references.md](official-references.md).
