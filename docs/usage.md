# Tool examples

List `figma_sessions` and copy the intended `sessionId`. All node IDs below are placeholders for IDs returned by the real plugin. Generate each new mutation UUID with `node -e 'console.log(crypto.randomUUID())'`; never reuse an example UUID for a new change.

Document context returns the document name, page identity and selection. `fileKey` is always `null`; this connector uses the public Plugin API and targets live sessions rather than file keys.

Read the selection:

```json
{
  "sessionId": "SESSION_ID",
  "depth": 2,
  "maxNodes": 100,
  "maxTextLength": 2000
}
```

Create a frame using `figma_create_node`:

```json
{
  "sessionId": "SESSION_ID",
  "mutationId": "NEW_UUID",
  "type": "FRAME",
  "properties": {
    "name": "Connector sample",
    "x": 100,
    "y": 100,
    "width": 400,
    "height": 240,
    "fills": [{"r": 0.96, "g": 0.97, "b": 0.98}],
    "autoLayout": {
      "layoutMode": "VERTICAL",
      "paddingTop": 24,
      "paddingRight": 24,
      "paddingBottom": 24,
      "paddingLeft": 24,
      "itemSpacing": 12,
      "primaryAxisSizingMode": "FIXED",
      "counterAxisSizingMode": "FIXED"
    }
  }
}
```

Create text under the returned frame ID:

```json
{
  "sessionId": "SESSION_ID",
  "mutationId": "ANOTHER_NEW_UUID",
  "type": "TEXT",
  "parentId": "FRAME_NODE_ID",
  "properties": {
    "name": "Status",
    "characters": "Hello from Codex",
    "font": {"family": "Inter", "style": "Regular"},
    "fontSize": 24,
    "fills": [{"r": 0.08, "g": 0.1, "b": 0.12}]
  }
}
```

Update that text through `figma_update_node`:

```json
{
  "sessionId": "SESSION_ID",
  "mutationId": "ANOTHER_NEW_UUID",
  "nodeId": "TEXT_NODE_ID",
  "properties": {"characters": "Connected locally", "fontSize": 28}
}
```

Export using `figma_export_nodes`:

```json
{"sessionId": "SESSION_ID", "nodeIds": ["FRAME_NODE_ID"], "format": "PNG", "scale": 1}
```

Use `format: "SVG"` for a vector file. PNG output includes native MCP image content and a local path. SVG output includes a local resource link and metadata. Read limits are depth 0–10, 1–500 total nodes, and up to 20,000 text characters per node. Defaults are 2, 100 and 2,000. Export accepts at most five nodes, scale 0.1–4, at most 16 megapixels, 8 MiB per file and 10 MiB total before base64 encoding.

After an uncertain mutation:

```json
{"requestId": "THE_ORIGINAL_MUTATION_UUID"}
```

Call `figma_request_status` with the original ID. If it remains uncertain, read the known affected node IDs or inspect the page before deciding to issue any further edit. Request IDs identify attempts; they are not a rollback or transaction mechanism.
