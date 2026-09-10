import { ConnectorError } from '../errors.js';

export function validateCdpEndpoint(value: string): string {
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/?$/.exec(value);
  if (!match || Number(match[1]) > 65535) {
    throw new ConnectorError('CHROME_CONFIG_ERROR', 'FIGMA_CONNECTOR_CDP_URL must be http://127.0.0.1:<port> with no credentials, path, query or fragment.');
  }
  return `http://127.0.0.1:${match[1]}`;
}

export function validatePageUrl(value: string, fixtureOrigin?: string): string {
  if (value === 'about:blank') return value;
  let url: URL;
  try { url = new URL(value); }
  catch { throw new ConnectorError('CHROME_URL_REJECTED', 'Use an HTTPS Figma URL or about:blank.'); }
  const figma = url.protocol === 'https:' && ['figma.com', 'www.figma.com'].includes(url.hostname) && (!url.port || url.port === '443');
  const fixture = fixtureOrigin && url.origin === fixtureOrigin;
  if ((!figma && !fixture) || url.username || url.password) {
    throw new ConnectorError('CHROME_URL_REJECTED', 'Browser interaction is limited to HTTPS Figma pages and about:blank. Sign in through Chrome manually when another site is required.');
  }
  return url.href;
}

export function validateFixtureOrigin(value: string): string {
  const endpoint = validateCdpEndpoint(value);
  return new URL(endpoint).origin;
}
