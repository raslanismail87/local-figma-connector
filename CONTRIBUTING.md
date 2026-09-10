# Contributing

This project welcomes focused fixes, compatibility evidence and improvements to its typed Figma tools. Discuss substantial feature changes before broad refactors once a project discussion channel is available.

## Develop locally

Use Node.js 20.19 or newer. From the checkout:

```sh
npm ci
npm run check
```

This runs typechecking, automated tests and production builds. Follow the [README](README.md) to run the bridge and import the built plugin in Figma Desktop. Read [architecture and lessons learned](docs/architecture.md) before changing the transport or plugin runtime.

Keep protocol validation separate from transport and document operations. Add focused regression coverage for behavior changes, particularly authentication, request correlation, timeouts, mutation deduplication and partial writes. Never introduce automatic mutation replay or an arbitrary JavaScript tool as a shortcut around the typed contract.

## Validate the affected layer

- `npm run check`: protocol, bridge, MCP and simulated Plugin API checks, plus compiled bundle validation.
- `npm run smoke:ui`: actual compiled pairing UI in a browser fixture with the real bridge; requires Chrome.
- `npm run smoke:chrome`: optional CDP tools against a local fixture in a disposable Chrome profile.
- `npm run smoke:live -- --document 'Codex Connector Smoke Test'`: actual paired Figma Desktop file. Create that disposable file, draw/select a rectangle and pair the plugin first. This command edits the file; do not point it at production work.

After a failed or uncertain live mutation, inspect the report and document before another run. Live smoke tests do not run unattended in CI. Reports go under `artifacts/` and exports under the private state directory; neither belongs in a contribution.

Describe the problem, resulting behavior, checks run and any remaining limitations. For compatibility reports include OS, Node, Figma Desktop and Chrome versions as relevant. Use a minimal disposable design rather than client documents. Distinguish simulated checks from real editor checks and documented support from observed behavior.

## Keep private state out of source control

Do not commit tokens, Codex configuration containing personal paths, design exports, mutation journals, browser profiles or screenshots of private work. Do not paste a pairing key into logs or issue reports. See [SECURITY.md](SECURITY.md) for vulnerability reporting guidance.

The project is distributed under the [MIT license](LICENSE). Preserve [third-party notices](THIRD_PARTY_NOTICES.md) when redistributing generated bundles.
