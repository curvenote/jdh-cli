import fs from "node:fs";
import path from "node:path";
import { fileExists } from "../../engine/context.js";
import {
  placeholderWarning,
  SIDEBAR_IMAGES,
} from "../../engine/sidebar-images.js";
import type { PipelineStep, RunContext } from "../../engine/types.js";
import {
  GENERATED_DIR,
  resolveBundledLogo,
} from "../../init/bundled-assets.js";
import { renderFingerprint } from "../shared/fingerprint.js";
import { resolveProjectConfigPath } from "../shared/myst-config.js";
import { renderQrPng } from "../shared/qr-code.js";
import { readYamlDocument } from "../shared/yaml-doc.js";
import { articleUrl, resolveArticleId } from "./set-jdh-article-metadata.js";

type SidebarImage = (typeof SIDEBAR_IMAGES)[number];

/** The article URL the QR code points to: `--url`, else the one set in myst.yml, else the JDH page for the repo's article id. */
function resolveQrUrl(ctx: RunContext): string | null {
  if (ctx.options.url) return ctx.options.url;
  try {
    const url = readYamlDocument(
      resolveProjectConfigPath(ctx.workdirAbs),
    ).getIn(["project", "social", "url"]);
    if (typeof url === "string" && url) return url;
  } catch {
    // No readable myst.yml: fall back to the article id.
  }
  const id = resolveArticleId(ctx.projectRoot);

  return id ? articleUrl(id) : null;
}

async function generate(
  img: SidebarImage,
  ctx: RunContext,
): Promise<{ bytes: Buffer; from: string }> {
  if (img.file === "qr.png") {
    const url = resolveQrUrl(ctx);
    if (!url)
      throw new Error(
        "no article URL: the JDH article id is not in the git remote or folder name; pass --url",
      );

    return {
      bytes: renderQrPng(url, fs.readFileSync(resolveBundledLogo())),
      from: url,
    };
  }
  if (!fileExists(ctx.articleIpynb))
    throw new Error("no article.ipynb in the article repo");
  const { png } = await renderFingerprint(ctx.articleIpynb);

  return { bytes: png, from: "article.ipynb" };
}

/**
 * Generate the sidebar images that were neither given (`--qr-code`,
 * `--fingerprint`) nor found in the repo's `generated/`: the QR code from the
 * article URL, the fingerprint from `article.ipynb`. They replace the
 * placeholders in the workdir's `generated/`; when one can't be generated, the
 * placeholder stays, with a warning.
 */
export const generateSidebarImagesStep: PipelineStep = {
  id: "generateSidebarImages",
  label: "Generate QR code and fingerprint images",
  inputs: ["ipynb", "git", "project"],
  when: (ctx) => (ctx.options.generateImages ? "run" : "skip"),
  run: async (ctx) => {
    const missing = SIDEBAR_IMAGES.filter(
      (img) =>
        !ctx.options[img.option] &&
        !fileExists(path.join(ctx.projectRoot, GENERATED_DIR, img.file)),
    );

    if (!missing.length) {
      console.log(
        "QR code and fingerprint were given or are in the repo; nothing to generate.",
      );
      return;
    }
    for (const img of missing) {
      const dest = `${GENERATED_DIR}/${img.file}`;

      if (ctx.options.dryRun) {
        console.log(`[dry-run] would generate ${dest}`);
        continue;
      }

      try {
        const { bytes, from } = await generate(img, ctx);
        const abs = path.join(ctx.workdirAbs, dest);

        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, bytes);

        console.log(`${img.label}: generated ${dest} (from ${from})`);
      } catch (err) {
        console.log(
          placeholderWarning(
            img,
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
    }
  },
};
