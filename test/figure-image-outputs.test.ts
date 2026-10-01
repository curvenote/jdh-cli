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
