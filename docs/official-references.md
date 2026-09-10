# Official compatibility references

Verified on **2026-09-09** against the primary sources linked below. These are platform requirements and implementation implications. Actual Desktop and Chrome validation is recorded separately in [validation.md](validation.md).

## Free-plan operation and browser limits

Classic plugins run in Figma Design on the Starter plan. Creating a development plugin is supported on any plan. Use the Design editor; Dev Mode is a separate surface with different seat requirements. [Plugin access](https://help.figma.com/hc/en-us/articles/360042532714-Use-plugins-in-files), [development setup](https://help.figma.com/hc/en-us/articles/360042786733-Create-a-classic-plugin-for-development).

Figma's supported local plugin development and testing workflow requires the desktop app because it reads plugin files from disk. Import the built manifest through **Plugins → Development → Import new plugin from manifest** in Desktop. The official documentation provides no supported route to import and run this unpublished local plugin directly in Chrome. The practical unpublished workflow is to run the connector in Desktop and view the same synchronized document in Chrome. This last workflow is an implementation recommendation; verify synchronization in the actual document. [Plugin quickstart](https://developers.figma.com/docs/plugins/plugin-quickstart-guide/).

### Possible future Community release

Publishing a free classic plugin to the public Figma Community is supported on any plan. Submission requires Desktop, a development plugin, two-factor authentication, listing details, and Figma review. After approval, the Community listing provides the normal distribution route for users to run the plugin, including from the browser editor. This is a future route only: **this project does not submit, publish, or promise approval**. Private organization publishing is restricted to Organization and Enterprise plans. [Community publishing](https://help.figma.com/hc/en-us/articles/360042293394-Publish-classic-plugins-to-the-Figma-Community), [running plugins](https://help.figma.com/hc/en-us/articles/360042532714-Use-plugins-in-files), [internal plugins](https://help.figma.com/hc/en-us/articles/4404228629655-Create-internal-plugins-for-an-organization).

Public distribution alone does not establish that a localhost bridge works in Chrome. The production manifest and browser networking behavior require separate validation below.

## Plugin runtime and networking

The plugin main sandbox can manipulate the Figma scene. Browser APIs belong in the UI iframe opened by `figma.showUI()`. Put the WebSocket connection in that iframe and pass validated messages between UI and main. Keep the plugin running while the bridge is needed; closing or cancelling it ends the session. [How plugins run](https://developers.figma.com/docs/plugins/how-plugins-run/).

Figma's manifest permits `http`, `https`, `ws`, and `wss` schemes. Development server addresses belong in `networkAccess.devAllowedDomains`; match the actual hostname and port. A development-only configuration can use `allowedDomains: ["none"]` with a narrowly scoped `devAllowedDomains` entry for the loopback WebSocket. [Plugin manifest](https://developers.figma.com/docs/plugins/manifest/), [network requests](https://developers.figma.com/docs/plugins/making-network-requests/).

Live Desktop 126.8.18 validation on **2026-09-10** rejected `ws://127.0.0.1:3845` in `devAllowedDomains` as an invalid URL and accepted `ws://localhost:3845`. This connector therefore uses the latter in both the manifest and UI. Its bridge still binds to `127.0.0.1`; HTTP RPC requires that numeric host, while WebSocket upgrades also accept the exact `localhost` hostname and configured port. This is observed Desktop behavior, not a claim that every URL form described by the manifest documentation imports successfully.

For a future published version, move the required runtime endpoint into `allowedDomains` and supply the required `reasoning` for localhost access. Do not assume `devAllowedDomains` grants production access. Rebuild and inspect the final manifest, confirm that the declared endpoint exactly matches the connection URL, and retest the published iframe's CSP behavior. A permissive Figma manifest does not override Chrome permissions, mixed-content enforcement, or iframe policy. These verification steps follow from the separate Figma and Chrome controls described in the sources.

### Chrome Local Network Access

Chrome's Local Network Access (LNA) restrictions include loopback services. Permission is limited to secure contexts. The initial Chrome 142 rollout covered other request types; **Chrome 147 explicitly extends the restrictions to WebSockets**, so older documentation saying WebSockets are exempt is not a current compatibility guarantee. [LNA overview](https://developer.chrome.com/blog/local-network-access), [Chrome 147 release notes](https://developer.chrome.com/release-notes/147).

The Chromium implementation discussion identifies iframe connections as a possible breakage case and explains that destinations not recognizable as local from their URL can still encounter mixed-content blocking. A plugin cannot assume it controls permissions delegated by Figma's containing iframe. [Chromium WebSocket LNA shipping discussion](https://groups.google.com/a/chromium.org/g/blink-dev/c/O6GMKt44Ups).

Consequently, a future Community release must be exercised inside the real Figma-hosted iframe in the target Chrome version, with default security settings, checking connection success, permission denial, reconnect, and clear error reporting. Record the actual Chrome version and any host permission-policy failure. Passing a standalone localhost page or Desktop test is insufficient evidence. Do not recommend disabling browser security as the normal setup. Whether Figma's current host delegates the necessary permission remains **unverified here**.

## Fonts and undo

Before editing text content or properties that affect its layout, load the fonts it uses. Mixed-font text requires obtaining all fonts, for example through `getRangeAllFontNames`, and loading them. Setting `fontName` requires the new font. Check `hasMissingFont`; `loadFontAsync` only loads fonts already available to the editor and cannot fetch arbitrary fonts from the internet. [Working with text](https://developers.figma.com/docs/plugins/working-with-text/), [loadFontAsync](https://developers.figma.com/docs/plugins/api/properties/figma-loadfontasync/).

`figma.commitUndo()` establishes boundaries in undo history; it does not trigger undo. Commit after a successful mutation command or batch so user undo can revert that unit. The documented API does not provide transaction atomicity: validate inputs and load fonts before mutation, and report partial failures accurately. Do not assume an undocumented `figma.triggerUndo()` method exists. [commitUndo](https://developers.figma.com/docs/plugins/api/properties/figma-commitundo/).

## Playwright attachment to Chrome

`chromium.connectOverCDP()` attaches to an existing Chromium browser through an HTTP or WebSocket CDP endpoint. Existing contexts are exposed through `browser.contexts()`. Playwright explicitly describes CDP attachment as lower fidelity than its own protocol and warns that launch arguments can affect functionality. Treat a successful attachment as browser access, not as proof that Figma plugin execution or the localhost bridge works. [BrowserType API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp).

For the command-line remote-debugging-port workflow, Chrome 136 and later ignore remote debugging switches against the default Chrome data directory. Supply a **separate, non-default `--user-data-dir`** alongside `--remote-debugging-port`. Do not point automation at the user's daily profile or copy its credential files. The dedicated profile needs its own normal interactive Figma login. [Chrome remote debugging change](https://developer.chrome.com/blog/remote-debugging-port).

Newer Playwright MCP documentation also describes a browser-channel attachment flow enabled by the user in Chrome's remote-debugging settings, and a browser extension flow. These are distinct from a connector that takes a numeric CDP endpoint; do not claim they are implemented here merely because Playwright documents them. [Connecting to browsers](https://playwright.dev/mcp/configuration/browser-extension).
