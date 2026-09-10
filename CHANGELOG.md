# Changelog

## Unreleased

- Optional remembered pairing reconnects after reopening the plugin, with explicit Forget and authentication-rejection cleanup.
- Local Figma development-ID configuration enables plugin-scoped storage without committing a user's registration to Git.

## 1.0.0 — Initial release

- Local authenticated bridge and stdio MCP server for a custom Figma Design development plugin.
- Session and selection discovery, bounded node reads, typed node creation/updates, and PNG/SVG exports.
- Persistent mutation IDs, duplicate suppression, uncertain-outcome recovery and partial-failure reporting.
- Optional Chrome CDP tools using a dedicated profile and restricted navigation.
- Compiled plugin/UI checks, transport and MCP tests, browser smoke scripts and a real desktop smoke workflow.
- Documented runtime fixes and validation limits from Figma Desktop 126.8.18 on macOS.
- Portable Codex configuration generation, Chrome discovery and clipboard helpers; MIT licensing, bundled dependency notices, contributor guidance and CI configuration.

The initial live editor validation used a Professional workspace. Starter compatibility is documented by Figma but was not tested on a Starter account. Current Community review guidelines generally exclude this MCP architecture; browser-hosted plugin networking remains unverified.
