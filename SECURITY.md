# Security

The connector is intended for one user's local machine. The bridge binds to IPv4 loopback and requires a shared pairing key. Possession of that key grants control of connected Figma documents within the supported tool contract. Only run and pair plugin code you trust.

The plugin keeps the key in memory and clears it on disconnect or pairing rejection. `npm run pair` copies it to the system clipboard; replace clipboard contents afterward. The bridge stores credentials, exported assets and mutation history in a private local state directory. On Windows, protect that directory with appropriate account filesystem permissions; Unix file modes do not establish Windows ACL protection.

Host/origin filtering, schema validation and bounded requests supplement authentication. They do not make the service suitable for public-network exposure or hostile authenticated clients. Keep the bridge and optional Chrome debugging endpoint on loopback. The dedicated Chrome profile may contain login credentials and should remain private.

## Reporting a vulnerability

Do not publish pairing keys, private design data or a working exploit against another user's setup. This local repository has no hosted reporting channel yet. Once hosted, use a private security advisory if the project enables one, or a private maintainer contact explicitly provided by that project. No private email address or advisory service is assumed to exist.

Prepare a minimal reproduction using a disposable design and a fresh local state directory. Include the affected version, operating system, expected boundary and observed behavior, with secrets removed. If no private channel exists, retain exploit details locally and ask the maintainer for a private reporting method without disclosing them publicly.

No response-time or supported-version policy has been established for this initial release.
