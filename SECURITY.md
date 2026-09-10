# Security

The connector is intended for one user's local machine. The bridge binds to IPv4 loopback and requires a shared pairing key. Possession of that key grants control of connected Figma documents within the supported tool contract. Only run and pair plugin code you trust.

By default, the plugin keeps the key in memory only while open. Disconnect pauses the connection and retains that in-memory key for Connect. The optional Remember setting saves it in Figma's local `clientStorage`, isolated by plugin ID and not synchronized in the document. This storage is not an encrypted vault and does not protect against someone who can inspect the local Figma profile. Unchecking Remember deletes the stored key; Forget pairing deletes it, clears memory and disconnects. Authentication rejection attempts to remove invalid saved credentials, with failures shown in the panel. [Figma storage guarantees](https://developers.figma.com/docs/plugins/api/figma-clientStorage/).

`npm run pair` copies the key to the system clipboard; replace clipboard contents afterward. The bridge stores credentials, exported assets and mutation history in a private local state directory. On Windows, protect that directory with appropriate account filesystem permissions; Unix file modes do not establish Windows ACL protection.

Host/origin filtering, schema validation and bounded requests supplement authentication. They do not make the service suitable for public-network exposure or hostile authenticated clients. Keep the bridge and optional Chrome debugging endpoint on loopback. The dedicated Chrome profile may contain login credentials and should remain private.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/raslanismail87/local-figma-connector/security/advisories/new) to report security issues privately. Do not publish pairing keys, private design data or exploit details in public issues.

Prepare a minimal reproduction using a disposable design and a fresh local state directory. Include the affected version, operating system, expected boundary and observed behavior, with secrets removed. If the private reporting form is unavailable, ask the maintainer for a private reporting method without disclosing exploit details publicly.

No response-time or supported-version policy has been established for this initial release.
