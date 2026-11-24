import { afterEach, describe, expect, spyOn, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { buildRunContext, parseConvertOptions } from "../src/engine/context.js";
import { resolveBundledLogo } from "../src/init/bundled-assets.js";
import { generateSidebarImagesStep } from "../src/steps/common/generate-sidebar-images.js";
import {
  buildFingerprintViewerUrl,
  wrapSvgStandalone,
} from "../src/steps/shared/fingerprint.js";
import { renderQrPng } from "../src/steps/shared/qr-code.js";

let tmpDir: string | undefined;
afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

describe("renderQrPng", () => {
  test("matches the Python generate_qrcode.py output pixel for pixel", () => {
    const url = "https://journalofdigitalhistory.org/en/article/BHmHNQKJaSWT";
    const ours = PNG.sync.read(
      renderQrPng(url, fs.readFileSync(resolveBundledLogo())),
    );
    const reference = PNG.sync.read(
      fs.readFileSync(path.join(import.meta.dir, "fixtures/qr-reference.png")),
    );
    expect([ours.width, ours.height]).toEqual([
      reference.width,
      reference.height,
    ]);
    expect(Buffer.compare(ours.data, reference.data)).toBe(0);
  });
});

describe("fingerprint helpers", () => {
  test("buildFingerprintViewerUrl encodes the notebook URL", () => {
    expect(
      buildFingerprintViewerUrl(
        "https://example.org/",
        "en",
        "https://x.org/a b.ipynb?x=1",
      ),
    ).toBe(
      "https://example.org/en/fingerprint-viewer?url=https%3A%2F%2Fx.org%2Fa+b.ipynb%3Fx%3D1",
    );
  });

  test("wrapSvgStandalone adds the XML declaration once", () => {
    const wrapped = wrapSvgStandalone("<svg/>");
    expect(wrapped).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<svg/>');
    expect(wrapSvgStandalone(wrapped)).toBe(wrapped);
  });
});

describe("generateSidebarImagesStep", () => {
  async function run(
    root: string,
    flags: Parameters<typeof parseConvertOptions>[0] = {},
  ): Promise<string> {
    const input = path.join(root, "article.md");
    fs.writeFileSync(input, "# A\n");
    const ctx = buildRunContext(
      "jupytext",
      input,
      parseConvertOptions({ projectRoot: root, ...flags }),
    );
    fs.mkdirSync(ctx.workdirAbs, { recursive: true });
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await generateSidebarImagesStep.run(ctx);
      return log.mock.calls.map((c) => String(c[0])).join("\n");
    } finally {
      log.mockRestore();
    }
  }

  function mkRoot(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jdh-gen-"));
    const root = path.join(tmpDir, "BHmHNQKJaSWT");
    fs.mkdirSync(path.join(root, "generated"), { recursive: true });
    return root;
  }

  test("generates the QR code from the article id; the fingerprint falls back without a notebook", async () => {
    const root = mkRoot();
    const out = await run(root);
    expect(out).toContain(
      "QR code: generated generated/qr.png (from https://journalofdigitalhistory.org/en/article/BHmHNQKJaSWT)",
    );
    expect(out).toContain("no article.ipynb in the article repo");
    expect(out).toContain("PLACEHOLDER fingerprint");
    const qr = PNG.sync.read(
      fs.readFileSync(path.join(root, "_improved/generated/qr.png")),
    );
    expect(qr.width).toBe(530);
    expect(
      fs.existsSync(path.join(root, "_improved/generated/fingerprint.png")),
    ).toBe(false);
  });

  test("--url is what the QR code encodes", async () => {
    const root = mkRoot();
    const out = await run(root, { url: "https://example.org/a" });
    expect(out).toContain("(from https://example.org/a)");
  });

  test("leaves images that were given or are in the repo alone", async () => {
    const root = mkRoot();
    fs.writeFileSync(path.join(root, "generated/fingerprint.png"), PNG_BYTES);
    const out = await run(root, { qrCode: "qr.png" });
    expect(out).toContain("nothing to generate");
    expect(fs.existsSync(path.join(root, "_improved/generated"))).toBe(false);
  });

  test("without an article id or --url there is no QR code, only a warning", async () => {
    const root = mkRoot();
    const renamed = path.join(path.dirname(root), "not-an-article");
    fs.renameSync(root, renamed);
    const out = await run(renamed);
    expect(out).toContain("no article URL");
    expect(out).toContain("PLACEHOLDER QR code");
  });

  test("is skipped with --no-generate-images", () => {
    const ctx = buildRunContext(
      "jupytext",
      "/x/article.md",
      parseConvertOptions({ generateImages: false }),
    );
    expect(generateSidebarImagesStep.when?.(ctx)).toBe("skip");
  });
});
