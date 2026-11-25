import { describe, expect, test } from "bun:test";
import {
  drawFingerprint,
  fingerprintFromNotebook,
  parseNotebook,
} from "../src/steps/shared/fingerprint-draw/index.js";

const cell = (
  cell_type: string,
  source: string,
  tags: string[] = [],
): Record<string, unknown> => ({ cell_type, source: [source], metadata: { tags } });

describe("parseNotebook (port of the website's logic/parseNotebook.jsx)", () => {
  test("counts characters and cite2c markers, and tracks both extents", () => {
    const { cells, extentChars, extentRefs } = parseNotebook({
      cells: [
        cell("markdown", "# Title"),
        cell("code", "x = 1\ny = 2"),
        cell("markdown", 'see <cite data-cite="123/ABC">x</cite> and <cite data-cite="4/D">y</cite>'),
      ],
    });
    expect(cells.map((c) => c.countChars)).toEqual([7, 11, 73]);
    expect(cells.map((c) => c.countRefs)).toEqual([0, 0, 2]);
    expect(extentChars).toEqual([7, 73]);
    expect(extentRefs).toEqual([0, 2]);
  });

  test("a heading is a markdown cell starting with hashes", () => {
    const { cells } = parseNotebook({
      cells: [
        cell("markdown", "## Two"),
        cell("markdown", "  # indented"),
        cell("markdown", "#nospace"),
        cell("markdown", "not a heading"),
        cell("code", "# a comment, not a heading"),
      ],
    });
    expect(cells.map((c) => c.isHeading)).toEqual([true, true, false, false, false]);
  });

  test("hermeneutics comes from tags, and `hidden` wins", () => {
    const { cells } = parseNotebook({
      cells: [
        cell("markdown", "a", ["hermeneutics"]),
        cell("markdown", "b", ["hermeneutics-step"]),
        cell("markdown", "c", ["hermeneutics", "hidden"]),
        cell("markdown", "d", ["figure-1"]),
      ],
    });
    expect(cells.map((c) => c.isHermeneutic)).toEqual([true, true, false, false]);
  });

  test("a cell with no source or metadata is still counted", () => {
    const { cells } = parseNotebook({ cells: [{ cell_type: "code" }] });
    expect(cells).toEqual([
      { type: "code", countChars: 0, countRefs: 0, isHeading: false, isHermeneutic: false },
    ]);
  });
});

describe("drawFingerprint", () => {
  const data = parseNotebook({
    cells: [
      cell("markdown", "# Heading"),
      cell("code", "x".repeat(200), ["hermeneutics"]),
      cell("markdown", "a".repeat(500)),
      // The shortest cell sits exactly on the ring, since the character scale's
      // range starts at 0. Kept separate so cell 1 is free to point inward.
      cell("markdown", "x"),
    ],
  });

  test("one group per cell, laid out on a circle", () => {
    const svg = drawFingerprint(data, { size: 616 });
    expect(svg.match(/<g>/g)).toHaveLength(4);
    expect(svg).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="616" height="616"');
    // The ring is centred, and its radius follows ((size / 2 - margin) * 2) / 3.
    expect(svg).toContain('transform="translate(308, 308)"');
  });

  test("hermeneutics cells point inward, narrative cells outward", () => {
    const svg = drawFingerprint(data, { size: 616 });
    const radius = ((616 / 2 - 20) * 2) / 3;
    const lines = [...svg.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)];
    const reach = lines.map(([, , , x2, y2]) => Math.hypot(Number(x2), Number(y2)));
    expect(reach[1]).toBeLessThan(radius); // the hermeneutics code cell
    expect(reach[2]).toBeGreaterThan(radius); // the long narrative cell
  });

  test("the longest cell reaches the full character radius", () => {
    const svg = drawFingerprint(data, { size: 616 });
    const radius = ((616 / 2 - 20) * 2) / 3;
    const lines = [...svg.matchAll(/<line [^>]*x2="([-\d.]+)" y2="([-\d.]+)"/g)];
    const longest = Math.max(...lines.map(([, x2, y2]) => Math.hypot(Number(x2), Number(y2))));
    expect(longest).toBeCloseTo(radius + radius / 2, 5);
  });

  test("a heading gets its extra ring; a plain cell does not", () => {
    const groups = drawFingerprint(data, { size: 616 }).split("<g>").slice(1);
    expect(groups[0].match(/<circle/g)).toHaveLength(3); // origin, heading ring, cell dot
    expect(groups[2].match(/<circle/g)).toHaveLength(2); // origin, cell dot
  });

  test("an empty notebook is an error, not a blank image", () => {
    expect(() => drawFingerprint({ cells: [], extentChars: [0, 0], extentRefs: [0, 0] })).toThrow(
      "no cells",
    );
  });

  test("fingerprintFromNotebook goes from JSON text to SVG", () => {
    const svg = fingerprintFromNotebook(
      JSON.stringify({ cells: [cell("markdown", "# Only")] }),
    );
    expect(svg).toContain("<svg");
    expect(svg.match(/<g>/g)).toHaveLength(1);
  });
});
