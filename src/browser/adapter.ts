import { chromium, errors, type Browser, type Locator, type Page } from 'playwright-core';
import { ConnectorError } from '../errors.js';
import { validateCdpEndpoint, validateFixtureOrigin, validatePageUrl } from './policy.js';

export type BrowserTarget = { role: Parameters<Page['getByRole']>[0]; name: string; exact?: boolean } | { selector: string };
export type ClickTarget = BrowserTarget | { x: number; y: number };
export interface BrowserOptions {
  endpoint?: string;
  timeoutMs?: number;
  testFixtureOrigin?: string;
}

export class ChromeAdapter {
  private readonly endpoint?: string;
  private readonly timeout: number;
  private readonly fixtureOrigin?: string;
  private browser?: Browser;
  private connecting?: Promise<Browser>;
  private readonly tabs = new Map<string, Page>();
  private nextTab = 1;
  private selected?: string;

  constructor(options: BrowserOptions = {}) {
    const endpoint = options.endpoint ?? process.env.FIGMA_CONNECTOR_CDP_URL;
    this.endpoint = endpoint ? validateCdpEndpoint(endpoint) : undefined;
    this.timeout = options.timeoutMs ?? 10000;
    if (!Number.isInteger(this.timeout) || this.timeout < 1 || this.timeout > 30000) throw new ConnectorError('CHROME_CONFIG_ERROR', 'Chrome action timeout must be between 1 and 30000 milliseconds.');
    this.fixtureOrigin = options.testFixtureOrigin ? validateFixtureOrigin(options.testFixtureOrigin) : undefined;
  }

  private async connect(): Promise<Browser> {
    if (!this.endpoint) throw new ConnectorError('CHROME_DISABLED', 'Chrome tools are optional. Run npm run chrome:launch and set FIGMA_CONNECTOR_CDP_URL=http://127.0.0.1:9222 in the MCP environment, then restart the MCP server.');
    if (this.browser?.isConnected()) return this.browser;
    if (this.connecting) return this.connecting;
    this.connecting = chromium.connectOverCDP(this.endpoint, { timeout: this.timeout, noDefaults: true }).then(browser => {
      this.browser = browser;
      this.tabs.clear();
      this.selected = undefined;
      return browser;
    }).catch(() => {
      throw new ConnectorError('CHROME_UNAVAILABLE', 'Cannot attach to the configured local Chrome endpoint. Start the dedicated Chrome profile, verify its debugging port, and retry this read. No browser action was submitted.');
    }).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private syncTabs(browser: Browser) {
    const pages = browser.contexts().flatMap(context => context.pages()).filter(page => !page.isClosed());
    for (const [id, page] of this.tabs) if (!pages.includes(page)) this.tabs.delete(id);
    for (const page of pages) if (![...this.tabs.values()].includes(page)) this.tabs.set(`chrome-${this.nextTab++}`, page);
    if (this.selected && !this.tabs.has(this.selected)) this.selected = undefined;
  }

  private async page(tabId?: string): Promise<{ page: Page; tabId: string }> {
    this.syncTabs(await this.connect());
    const id = tabId ?? this.selected;
    if (!id) throw new ConnectorError('CHROME_TAB_REQUIRED', 'Call chrome_tabs and chrome_select_tab, or supply an explicit tabId.');
    const page = this.tabs.get(id);
    if (!page) throw new ConnectorError('CHROME_TAB_NOT_FOUND', 'This tab is closed or belongs to an earlier connection. Call chrome_tabs to get current IDs.');
    validatePageUrl(page.url(), this.fixtureOrigin);
    return { page, tabId: id };
  }

  private locator(page: Page, target: BrowserTarget): Locator {
    return 'selector' in target ? page.locator(target.selector) : page.getByRole(target.role, { name: target.name, exact: target.exact ?? true });
  }

  private async mutation<T>(action: string, tabId: string | undefined, run: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([run(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new errors.TimeoutError('Browser action timed out.')), this.timeout);
      })]);
    } catch (error) {
      throw new ConnectorError('CHROME_ACTION_UNCERTAIN', 'The browser action did not complete cleanly and may have taken effect. Inspect the tab or screenshot before deciding what to do. Do not automatically replay the action.', {
        action, ...(tabId ? { tabId } : {}), outcome: 'unknown', retryable: false,
        cause: error instanceof errors.TimeoutError ? 'timeout' : 'browser_error',
      });
    } finally { clearTimeout(timer); }
  }

  async listTabs() {
    const browser = await this.connect();
    this.syncTabs(browser);
    const tabs = await Promise.all([...this.tabs].map(async ([tabId, page]) => ({ tabId, title: (await page.title()).slice(0, 500), url: page.url().slice(0, 4000), selected: tabId === this.selected })));
    return { browserVersion: browser.version(), tabs };
  }

  async openTab(url: string) {
    const destination = validatePageUrl(url, this.fixtureOrigin);
    const browser = await this.connect();
    const context = browser.contexts()[0];
    if (!context) throw new ConnectorError('CHROME_CONTEXT_UNAVAILABLE', 'The attached Chrome has no browser context. Open a window in the dedicated profile.');
    const page = await this.mutation('open_tab', undefined, () => context.newPage());
    this.syncTabs(browser);
    const tabId = [...this.tabs].find(([, candidate]) => candidate === page)![0];
    await this.mutation('navigate_new_tab', tabId, () => page.goto(destination, { timeout: this.timeout, waitUntil: 'domcontentloaded' }));
    return { tabId, url: page.url(), selected: false };
  }

  async selectTab(tabId: string) {
    const { page } = await this.page(tabId);
    await this.mutation('select_tab', tabId, () => page.bringToFront());
    this.selected = tabId;
    return { tabId, url: page.url(), selected: true };
  }

  async navigate(url: string, tabId?: string) {
    const destination = validatePageUrl(url, this.fixtureOrigin);
    const target = await this.page(tabId);
    await this.mutation('navigate', target.tabId, () => target.page.goto(destination, { timeout: this.timeout, waitUntil: 'domcontentloaded' }));
    return { tabId: target.tabId, url: target.page.url() };
  }

  async snapshot(options: { tabId?: string; selector?: string; depth: number; maxCharacters: number }) {
    const { page, tabId } = await this.page(options.tabId);
    const snapshot = await page.locator(options.selector ?? 'body').ariaSnapshot({ depth: options.depth, boxes: true, timeout: this.timeout });
    return { tabId, url: page.url(), snapshot: snapshot.slice(0, options.maxCharacters), truncated: snapshot.length > options.maxCharacters, totalCharacters: snapshot.length, depth: options.depth, coordinateUnits: 'CSS pixels relative to the viewport' };
  }

  async click(target: ClickTarget, tabId?: string) {
    const current = await this.page(tabId);
    await this.mutation('click', current.tabId, () => 'x' in target ? current.page.mouse.click(target.x, target.y) : this.locator(current.page, target).click({ timeout: this.timeout }));
    return { tabId: current.tabId, completed: true };
  }

  async fill(target: BrowserTarget, value: string, tabId?: string) {
    const current = await this.page(tabId);
    await this.mutation('fill', current.tabId, () => this.locator(current.page, target).fill(value, { timeout: this.timeout }));
    return { tabId: current.tabId, completed: true };
  }

  async keypress(key: string, tabId?: string) {
    const current = await this.page(tabId);
    await this.mutation('keypress', current.tabId, () => current.page.keyboard.press(key));
    return { tabId: current.tabId, completed: true };
  }

  async screenshot(tabId?: string) {
    const current = await this.page(tabId);
    const png = await current.page.screenshot({ type: 'png', fullPage: false, timeout: this.timeout, scale: 'css' });
    if (png.byteLength > 10 * 1024 * 1024) throw new ConnectorError('CHROME_SCREENSHOT_TOO_LARGE', 'The screenshot exceeds 10 MiB. Reduce the Chrome window size and try again.');
    return { png, metadata: { tabId: current.tabId, url: current.page.url(), mimeType: 'image/png' as const, width: png.readUInt32BE(16), height: png.readUInt32BE(20), bytes: png.byteLength, coordinateUnits: 'CSS pixels relative to the viewport' } };
  }

  async disconnect() {
    await this.browser?.close();
    this.browser = undefined;
    this.tabs.clear();
    this.selected = undefined;
  }
}
