# Third-party notices

Project source is covered by [LICENSE](LICENSE). Dependencies retain their own
licenses; the lockfile records the exact installed versions. This repository
does not vendor `node_modules`.

The generated Figma plugin bundles Zod. The build copies Zod's unmodified MIT
license from `node_modules/zod/LICENSE` to `dist/plugin/ZOD-LICENSE`, alongside
the project's `LICENSE`. Preserve both files when redistributing the generated
plugin directory. Removing comments for Figma sandbox compatibility does not
remove the dependency's attribution requirement.

The Node bundles load their dependencies from `node_modules` rather than
embedding them. If distributing an installed runtime, retain those packages'
license and notice files too. Direct runtime dependencies are the MCP SDK
(MIT), Zod (MIT), ws (MIT), and Playwright Core (Apache-2.0).
