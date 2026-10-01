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

test('image outputs are typed by their bytes, and unreadable formats get a placeholder', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]).toString('base64');
  const webp = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ').toString('base64');
  const { workdir, ctx } = setupCells(
    [
      codeCell(['figure-a-*'], [{ output_type: 'display_data', data: { 'image/png': jpeg } }]),
      codeCell(['figure-b-*'], [{ output_type: 'display_data', data: { 'image/png': webp } }]),
    ],
    '```python jdh={"object": {"source": ["A"]}} tags=["figure-a-*"]\nshow()\n```\n\n```python jdh={"object": {"source": ["B"]}} tags=["figure-b-*"]\nshow()\n```\n',
  );
  await improveNotebookFiguresStep.run(ctx);
  const md = fs.readFileSync(path.join(workdir, 'article.md'), 'utf8');
  expect(md).toContain('```{figure} notebook-outputs/fig-a.jpg');
  expect(md).toContain('```{figure} notebook-outputs/placeholder-figure.svg\n:label: fig:b\n\nB. [View it in the online article.]');
});

const AUDIO_HTML = '<audio controls="controls"><source src="data:audio/mpeg;base64,//uQRAAA" type="audio/mpeg" /></audio>';
const URL = 'https://journalofdigitalhistory.org/en/article/6ig87tC5GKjQ';

test('audio cells become "Sound" figures with a speaker icon, linking to the player online (JDH-007, JDH-034)', async () => {
  const caption = { jdh: { object: { type: 'image', source: ['**Citation:**\n*“Interview with John Hope Franklin.”*\nhttps://docsouth.unc.edu/sohp/A-0339/menu.html'] } } };
  const { workdir, ctx } = setupCells(
    [
      markdownCell,
      codeCell(['sound-franklin-*'], [{ output_type: 'display_data', data: { 'text/html': AUDIO_HTML }, metadata: caption }]),
    ],
    '```python tags=["sound-franklin-*"]\ndisplay(Audio(audio_url), metadata=metadata)\n```\n',
  );
  await improveNotebookFiguresStep.run(ctx);
  const md = fs.readFileSync(path.join(workdir, 'article.md'), 'utf8');
  expect(md).toContain(
    '```{figure} notebook-outputs/sound.svg\n:label: aud:franklin\n:kind: sound\n:width: 9%\n:align: left\n\n**Citation:**\n*“Interview with John Hope Franklin.”*\nhttps://docsouth.unc.edu/sohp/A-0339/menu.html ' +
      `[Listen to it in the online article.](${URL}?idx=1)\n\`\`\``,
  );
  expect(fs.existsSync(path.join(workdir, 'notebook-outputs', 'sound.svg'))).toBe(true);
});

test('audio cells with no caption still become a numbered, linked entry; hermeneutic ones stay in their block', async () => {
  const { workdir, ctx } = setupCells(
    [codeCell(['narrative', 'hermeneutics', 'sound-worldcup-*'], [{ output_type: 'execute_result', data: { 'text/html': AUDIO_HTML } }])],
    '```python tags=["narrative", "hermeneutics", "sound-worldcup-*"]\nipd.Audio("media/a.m4v")\n```\n',
  );
  await improveNotebookFiguresStep.run(ctx);
  expect(fs.readFileSync(path.join(workdir, 'article.md'), 'utf8')).toContain(
    `:::{hermeneutics}\n\n\`\`\`{figure} notebook-outputs/sound.svg\n:label: aud:worldcup\n:kind: sound\n:width: 9%\n:align: left\n\nAudio recording. [Listen to it in the online article.](${URL}?idx=0)\n\`\`\`\n:::`,
  );
});

test('a figure with an image and an audio player keeps the image and links to the player', async () => {
  const { workdir, ctx } = setupCells(
    [
      codeCell(['figure-waveform-*'], [
        { output_type: 'display_data', data: { 'image/png': PNG_B64 } },
        { output_type: 'display_data', data: { 'text/html': AUDIO_HTML } },
      ]),
    ],
    '```python jdh={"object": {"source": ["Waveform of a sample"]}} tags=["figure-waveform-*"]\nplot()\n```\n',
  );
  await improveNotebookFiguresStep.run(ctx);
  expect(fs.readFileSync(path.join(workdir, 'article.md'), 'utf8')).toContain(
    '```{figure} notebook-outputs/fig-waveform.png\n:label: fig:waveform\n\n' +
      `Waveform of a sample. [Listen to it in the online article.](${URL}?idx=0)`,
  );
});

test('no extra full stop after a caption that ends in quotes and emphasis', async () => {
  const caption = { jdh: { object: { source: ['*“Interview with Bao Ninh.”*'] } } };
  const { workdir, ctx } = setupCells(
    [codeCell(['sound-baoninh-*'], [{ output_type: 'display_data', data: { 'text/html': AUDIO_HTML }, metadata: caption }])],
    '```python tags=["sound-baoninh-*"]\ndisplay(Audio(u), metadata=metadata)\n```\n',
  );
  await improveNotebookFiguresStep.run(ctx);
  expect(fs.readFileSync(path.join(workdir, 'article.md'), 'utf8')).toContain('*“Interview with Bao Ninh.”* [Listen to it');
});
