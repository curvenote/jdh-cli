import fs from "node:fs";
import type { Browser, BrowserType, Page, Route } from "playwright-core";

/**
 * Article fingerprint for the PDF sidebar. Port of dev/generate_fingerprint_svg.py.
 *
 * The fingerprint is drawn by the JDH website's `/fingerprint-viewer` page, so
 * it is rendered in a headless browser and the live SVG is read back. The page
 * downloads the notebook from a URL in the browser; here that request is
 * answered with the repo's own `article.ipynb`, so the article does not have to
 * be published (or reachable on GitHub) yet.
 */

export const JDH_SITE = "https://journalofdigitalhistory.org";
const NOTEBOOK_URL = "https://jdh-cli.invalid/article.ipynb";
const SVG_SELECTOR = "svg.ArticleFingerprint";

/** The PNG is rendered at this multiple of the SVG's pixel size. */
const PNG_SCALE = 3;

export interface FingerprintOptions {
  baseUrl?: string;
  lang?: string;
  timeoutMs?: number;
}

export interface Fingerprint {
  /** Standalone SVG markup with the page's CSS inlined. */
  svg: string;
  /** PNG of the SVG on a transparent background. */
  png: Buffer;
}

export function buildFingerprintViewerUrl(
  baseUrl: string,
  lang: string,
  notebookUrl: string,
): string {
  return `${baseUrl.replace(/\/+$/, "")}/${lang}/fingerprint-viewer?${new URLSearchParams({ url: notebookUrl })}`;
}

/**
 * Make the page's SVG stand on its own, outside the website.
 *
 * The viewer leaves one `var(--secondary)` presentation attribute in the markup, which
 * resolves only against the site's stylesheet. The inlined style already carries the
 * colour it resolved to, so nothing is lost by dropping it — but left in, the file is
 * not valid on its own: ImageMagick refuses it outright. (Typst tolerates it, so this
 * is for everything else that opens the written generated/fingerprint.svg.)
 */
export function sanitizeSvg(svg: string): string {
  return svg.replace(/\s[a-zA-Z-]+="var\(--[^)"]*\)"/g, '');
}

export function wrapSvgStandalone(svg: string): string {
  return svg.trimStart().startsWith("<?xml")
    ? svg
    : `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
}

/** Runs in the page: clone the SVG with the computed paint properties inlined, so it renders without the site's CSS. */
const INLINE_STYLES = `(() => {
  const svg = document.querySelector('${SVG_SELECTOR}');
  if (!svg) return null;
  const props = ['fill', 'stroke', 'stroke-width', 'opacity'];
  const style = (el) => {
    const computed = window.getComputedStyle(el);
    return props.map((p) => p + ':' + computed.getPropertyValue(p)).join(';');
  };
  const clone = svg.cloneNode(true);
  const originals = svg.querySelectorAll('*');
  const clones = clone.querySelectorAll('*');
  originals.forEach((el, i) => clones[i].setAttribute('style', style(el)));
  clone.setAttribute('style', style(svg));
  return clone.outerHTML;
})()`;

async function loadChromium(): Promise<BrowserType> {
  // A variable specifier keeps the bundler from inlining this optional dependency.
  const name = "playwright-core";
  try {
    return ((await import(name)) as typeof import("playwright-core")).chromium;
  } catch (err) {
    throw new Error(
      "playwright-core is not installed (bun add playwright-core)",
      { cause: err },
    );
  }
}

/** Playwright's own Chromium, else an installed Google Chrome. */
async function launchBrowser(): Promise<Browser> {
  const chromium = await loadChromium();
  try {
    return await chromium.launch();
  } catch (bundledErr) {
    try {
      return await chromium.launch({ channel: "chrome" });
    } catch {
      throw new Error(
        "no browser to render the fingerprint: install one with `npx playwright-core install chromium`, or install Google Chrome",
        { cause: bundledErr },
      );
    }
  }
}

/** Answer the viewer's notebook request (and its CORS preflight) with the local notebook. */
async function serveNotebook(page: Page, notebook: Buffer): Promise<void> {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
  };
  await page.route(NOTEBOOK_URL, (route: Route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: cors,
          body: notebook,
        }),
  );
}

/** Render the fingerprint of the notebook file at `notebookPath`. */
export async function renderFingerprint(
  notebookPath: string,
  options: FingerprintOptions = {},
): Promise<Fingerprint> {
  const { baseUrl = JDH_SITE, lang = "en", timeoutMs = 60_000 } = options;
  const notebook = fs.readFileSync(notebookPath);
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await serveNotebook(page, notebook);
    await page.goto(buildFingerprintViewerUrl(baseUrl, lang, NOTEBOOK_URL), {
      waitUntil: "networkidle",
      timeout: timeoutMs,
    });

    try {
      await page.waitForSelector(`${SVG_SELECTOR} g g`, { timeout: timeoutMs });
    } catch (err) {
      throw new Error(
        "timed out waiting for the fingerprint SVG to render (is article.ipynb a valid notebook?)",
        { cause: err },
      );
    }

    const markup = await page.evaluate<string | null>(INLINE_STYLES);
    if (!markup) {
      throw new Error(
        "could not find the rendered fingerprint SVG on the page",
      );
    }

    const svg = wrapSvgStandalone(sanitizeSvg(markup));

    const pngPage = await browser.newPage({ deviceScaleFactor: PNG_SCALE });
    await pngPage.setContent(
      `<!DOCTYPE html><html><body style="margin:0;background:transparent">${svg}</body></html>`,
    );
    const png = await pngPage
      .locator("svg")
      .first()
      .screenshot({ omitBackground: true });
    return { svg, png };
  } finally {
    await browser.close();
  }
}
