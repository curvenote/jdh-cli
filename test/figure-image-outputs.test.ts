import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'bun:test';
import type { RunContext } from '../src/engine/types.js';
import { improveNotebookFiguresStep } from '../src/steps/jupytext/improve-notebook-figures.js';

// 1×1 transparent PNG, split over lines as Jupyter stores long base64 strings.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let tmpDir: string | undefined;
afterEach(() => {
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = undefined;
});

test('decodes an image output into notebook-outputs/ and points the figure at it', async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-fig-'));
  const workdir = path.join(tmpDir, '_improved');
  fs.mkdirSync(workdir);
  fs.writeFileSync(
    path.join(workdir, 'article.md'),
    '```python jdh={"object": {"source": ["A chart"]}} tags=["figure-chart-*"]\nplt.plot(x)\n```\n',
  );
  fs.writeFileSync(
    path.join(workdir, 'article.ipynb'),
    JSON.stringify({
      cells: [
        {
          cell_type: 'code',
          metadata: { tags: ['figure-chart-*'] },
          source: 'plt.plot(x)',
          outputs: [
            {
              output_type: 'display_data',
              data: { 'image/png': [PNG_B64.slice(0, 40) + '\n', PNG_B64.slice(40)], 'text/plain': '<Figure>' },
              metadata: {},
            },
          ],
        },
      ],
    }),
  );

  const ctx = {
    workdirAbs: workdir,
    projectRoot: tmpDir,
    options: { dryRun: false },
  } as unknown as RunContext;
  await improveNotebookFiguresStep.run(ctx);

  const md = fs.readFileSync(path.join(workdir, 'article.md'), 'utf8');
  expect(md).toContain('```{figure} notebook-outputs/fig-chart.png\n:label: fig:chart\n\nA chart\n```');
  const written = fs.readFileSync(path.join(workdir, 'notebook-outputs', 'fig-chart.png'));
  expect(written.equals(Buffer.from(PNG_B64, 'base64'))).toBe(true);
});

function setupCells(cells: unknown[], md: string): { workdir: string; ctx: RunContext } {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdh-fig-'));
  const workdir = path.join(tmpDir, '_improved');
  fs.mkdirSync(workdir);
  fs.writeFileSync(path.join(workdir, 'article.md'), md);
  fs.writeFileSync(path.join(workdir, 'article.ipynb'), JSON.stringify({ cells }));
  const ctx = {
    workdirAbs: workdir,
    projectRoot: tmpDir,
    options: { dryRun: false, url: 'https://journalofdigitalhistory.org/en/article/6ig87tC5GKjQ' },
  } as unknown as RunContext;
  return { workdir, ctx };
}

const codeCell = (tags: string[], outputs: unknown[]) => ({ cell_type: 'code', metadata: { tags }, source: '', outputs });
const markdownCell = { cell_type: 'markdown', metadata: {}, source: 'Intro' };

test('interactive output with no image becomes a linked placeholder (JDH-004)', async () => {
  const { workdir, ctx } = setupCells(
    [markdownCell, codeCell(['figure-pie-*'], [{ output_type: 'display_data', data: { 'text/html': '<div class="plotly-graph-div"></div>' } }])],
    '```python jdh={"object": {"source": ["Distribution by country"]}} tags=["figure-pie-*"]\nfig\n```\n',
  );
  await improveNotebookFiguresStep.run(ctx);
  const md = fs.readFileSync(path.join(workdir, 'article.md'), 'utf8');
  expect(md).toContain(
    '```{figure} notebook-outputs/placeholder-interactive.svg\n:label: fig:pie\n\nDistribution by country. [View it in the online article.](https://journalofdigitalhistory.org/en/article/6ig87tC5GKjQ?idx=1)\n```',
  );
  expect(fs.existsSync(path.join(workdir, 'notebook-outputs', 'placeholder-interactive.svg'))).toBe(true);
});

test('an image output in the same bundle is used instead of a placeholder', async () => {
  const { workdir, ctx } = setupCells(
    [codeCell(['figure-pie-*'], [{ output_type: 'display_data', data: { 'text/html': '<div></div>', 'image/png': PNG_B64 } }])],
    '```python jdh={"object": {"source": ["Pie"]}} tags=["figure-pie-*"]\nfig\n```\n',
  );
  await improveNotebookFiguresStep.run(ctx);
  expect(fs.readFileSync(path.join(workdir, 'article.md'), 'utf8')).toContain('```{figure} notebook-outputs/fig-pie.png');
});

test('a dataframe table output is left as code for the table step', async () => {
  const { workdir, ctx } = setupCells(
    [codeCell(['figure-df-*'], [{ output_type: 'execute_result', data: { 'text/html': '<table class="dataframe"></table>' } }])],
    '```python jdh={"object": {"source": ["A table"]}} tags=["figure-df-*"]\ndf\n```\n',
  );
  await improveNotebookFiguresStep.run(ctx);
  expect(fs.readFileSync(path.join(workdir, 'article.md'), 'utf8')).toContain('```python');
});

test('video cells get a video placeholder linking to the online article', async () => {
  const { workdir, ctx } = setupCells(
    [codeCell(['video-software-*'], [{ output_type: 'display_data', data: { 'text/html': '<iframe src="https://example.org/v"></iframe>' } }])],
    '```python tags=["video-software-*"]\nmetadata={"jdh":{"object":{"type":"video","source":["How to analyse an interview"]}}}\nIFrame("https://example.org/v")\n```\n',
  );
  await improveNotebookFiguresStep.run(ctx);
  const md = fs.readFileSync(path.join(workdir, 'article.md'), 'utf8');
  expect(md).toContain('```{figure} notebook-outputs/placeholder-video.svg\n:label: vid:software\n\nHow to analyse an interview. [View it in the online article.](https://journalofdigitalhistory.org/en/article/6ig87tC5GKjQ?idx=0)');
});
