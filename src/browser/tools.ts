import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ConnectorError, wireError } from '../errors.js';
import { ChromeAdapter, type BrowserOptions } from './adapter.js';

const selector = z.string().min(1).max(1000);
const role = z.enum(['button', 'checkbox', 'combobox', 'dialog', 'gridcell', 'heading', 'img', 'link', 'listbox', 'menu', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem']);
const roleTarget = z.object({ role, name: z.string().max(500), exact: z.boolean().default(true) }).strict();
const selectorTarget = z.object({ selector }).strict();
const target = z.union([roleTarget, selectorTarget]);
const clickTarget = z.union([roleTarget, selectorTarget, z.object({ x: z.number().min(0).max(32768), y: z.number().min(0).max(32768) }).strict()]);
const tabId = z.string().regex(/^chrome-[1-9]\d*$/).describe('Stable ID from chrome_tabs or chrome_open_tab. IDs expire after reconnect.');
const selectedTab = { tabId: tabId.optional().describe('Explicit tab ID, or omit after chrome_select_tab has selected a tab.') };
const navigation = { url: z.string().max(4000).describe('HTTPS URL on figma.com or www.figma.com, or about:blank.') };
const readOnly = { readOnlyHint: true, openWorldHint: true };
const mutating = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
const json = (data: object): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> });

async function safe(action: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try { return await action(); }
  catch (error) {
    const failure = error instanceof ConnectorError ? wireError(error) : { code: 'CHROME_READ_FAILED', message: 'Chrome could not complete this read. Inspect the browser and call chrome_tabs to check the connection.' };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(failure) }], structuredContent: { error: failure } };
  }
}

export function registerBrowserTools(server: McpServer, options: BrowserOptions = {}): ChromeAdapter {
  const chrome = new ChromeAdapter(options);
  server.registerTool('chrome_tabs', { description: 'List tabs in the optional dedicated Chrome profile. Browser controls require FIGMA_CONNECTOR_CDP_URL. Tab IDs are assigned by this connector; selection is explicit.', inputSchema: z.object({}).strict(), annotations: readOnly }, async () => safe(async () => json(await chrome.listTabs())));
  server.registerTool('chrome_open_tab', { description: 'Open a Figma URL or about:blank in a new tab. Returns an ID but does not select it. Use chrome_select_tab afterward. Never automatically retry an uncertain action.', inputSchema: z.object(navigation).strict(), annotations: mutating }, async ({ url }) => safe(async () => json(await chrome.openTab(url))));
  server.registerTool('chrome_select_tab', { description: 'Select a listed Figma tab and bring it to the foreground. Subsequent tools may omit tabId.', inputSchema: z.object({ tabId }).strict(), annotations: mutating }, async ({ tabId }) => safe(async () => json(await chrome.selectTab(tabId))));
  server.registerTool('chrome_navigate', { description: 'Navigate the selected or explicit tab to a Figma URL or about:blank. Navigation can have side effects even on timeout; inspect before any retry.', inputSchema: z.object({ ...selectedTab, ...navigation }).strict(), annotations: mutating }, async ({ url, tabId }) => safe(async () => json(await chrome.navigate(url, tabId))));
  server.registerTool('chrome_snapshot', { description: 'Read a bounded accessibility snapshot with element boxes in CSS viewport coordinates. Figma canvas content may be absent: use figma_read_nodes for document data and screenshots for visual context.', inputSchema: z.object({ ...selectedTab, selector: selector.optional(), depth: z.number().int().min(1).max(20).default(8), maxCharacters: z.number().int().min(100).max(30000).default(16000) }).strict(), annotations: readOnly }, async params => safe(async () => json(await chrome.snapshot(params))));
  server.registerTool('chrome_click', { description: 'Click a DOM target by exact role/name or CSS selector, or use explicit x/y CSS viewport coordinates from a recent screenshot. Use figma_create_node/figma_update_node for document mutations. Never automatically replay a failed action.', inputSchema: z.object({ ...selectedTab, target: clickTarget }).strict(), annotations: mutating }, async ({ target, tabId }) => safe(async () => json(await chrome.click(target, tabId))));
  server.registerTool('chrome_fill', { description: 'Fill a browser UI field using a role/name or CSS selector. Use the plugin tools for Figma node text changes. Failed actions may have taken effect; inspect before retrying.', inputSchema: z.object({ ...selectedTab, target, value: z.string().max(10000) }).strict(), annotations: mutating }, async ({ target, value, tabId }) => safe(async () => json(await chrome.fill(target, value, tabId))));
  server.registerTool('chrome_keypress', { description: 'Send a key or chord such as Enter, Escape, or ControlOrMeta+A to the selected or explicit tab. Keyboard actions may change state. Do not use to replay an uncertain document mutation.', inputSchema: z.object({ ...selectedTab, key: z.string().min(1).max(100) }).strict(), annotations: mutating }, async ({ key, tabId }) => safe(async () => json(await chrome.keypress(key, tabId))));
  server.registerTool('chrome_screenshot', { description: 'Capture the current tab viewport as a PNG image, with tab ID, URL, dimensions and CSS coordinate metadata. Useful for Figma canvas content inaccessible through DOM snapshots.', inputSchema: z.object(selectedTab).strict(), annotations: readOnly }, async ({ tabId }) => safe(async () => {
    const { png, metadata } = await chrome.screenshot(tabId);
    return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }, { type: 'text', text: JSON.stringify(metadata) }], structuredContent: metadata };
  }));
  return chrome;
}
