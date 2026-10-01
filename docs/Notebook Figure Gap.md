JDH-001 · P1 · from the June 2026 demo with JDH

# Notebook Figure Gap

jdh-cli builds the PDF from the Jupytext markdown, which drops every notebook output. The demo article looked complete because its figures happen to be image files. Most JDH articles aren't built that way. There, a figure the code computes arrives in the PDF as its source code, with no image and no caption.

Works today

BHmHNQKJaSWT PDF page 13: Figure 1 bar and dot chart with caption, then Table 1 truncated to three rows

**BHmHNQKJaSWT, page 13 of 26**Figure 1 is a PNG in `media/`, displayed with `Image()`, with its caption repeated in the code. It passes every check.

Fails today

Chronoferencing PDF page 10: a grey code block starting import plotly.graph_objects as go where the pie chart should be

**Chronoferencing (`6ig87tC5GKjQ`), page 10 of 98**Figure 2 is a Plotly pie chart. The PDF shows `import plotly.graph_objects as go` in a grey code block, with no chart and no caption. Built today with jdh-cli, unmodified.

What was discussed · transcript 21:48–26:45, 33:56

## How it came up in the meeting

After the demo, Steve asked about notebook output. The pipeline processes the markdown file, and outputs aren't in it. JDH then pointed to the chronoferencing article's pie chart as an example of what's missing.

"We are completely, at the moment, processing the MD file… we are not processing the notebook."

Steve · 23:03

"Here you don't have the output in the MD file."

Mirjam · 23:18

"The output, if it's around a figure, a video, an audio, a table…"

Mirjam · 23:40

"For that, we have to go back into the notebook… because we have the tags, so we can do the correspondence."

Steve · 26:28

"Focus on the high priority ones, which are the computational figures and outputs."

Steve · 33:56

JDH also set a boundary: stream output is logs and never belongs in the PDF (22:35–22:54). Outputs are wanted only when they are a figure, table, video or audio.

improveNotebookFigures · src/steps/jupytext/improve-notebook-figures.ts

## Why the demo article passes and most don't

Today a Python cell becomes a `{figure}` only if all four checks pass. If any fails, the cell stays a code block and the narrative-code plugin prints it in the PDF.

check 1**Python fence**The cell is a ```` ```python ```` block

check 2**Numbered tag**`figure-1-*`, `figure_1` or `fig:1`. Descriptive names fail

check 3**Image file call**`display(Image("path"…))` in the code

check 4**Caption in the code**A `"source": ["…"]` literal inside the code itself

| Cell · tag | Numbered tag | Image file | Caption in code | Caption elsewhere | Output in notebook | Today |
| --- | --- | --- | --- | --- | --- | --- |
| BHmHNQKJaSWT: 4 of 4 figures render |  |  |  |  |  |  |
| 42 · figure-1-\* | yes | media/figure1.png | yes | output metadata | `image/png` (same bytes as the file) | figure |
| 55 · figure-2-\* | yes | media/figure2.png | yes | output metadata | `image/png` (same) | figure |
| 57 · figure-3-\* | yes | media/figure3.png | yes | output metadata, **stale** | `image/png` (same) | figure |
| 60 · figure-4-\* | yes | media/figure4.png | yes | output metadata, **stale** | `image/png` (same) | figure |
| Chronoferencing: 0 of 7 figures render |  |  |  |  |  |  |
| 21 · figure-digital-history-practices-\* | descriptive | media/alternative_graph.png | no | cell metadata | `image/png` | code block |
| 30 · figure-pie-chart-citizen-scientists-country-\* | descriptive | computed (Plotly) | no | cell metadata | `text/html` ×2 only | code block |
| 33 · figure-cartoon-\* | descriptive | media/cartoon.png | no | cell metadata | `image/png` | code block |
| 135, 138, 140, 142 · figure-upload-…, figure-dig-cafe-…, figure-post-comments-…, figure-average-no-comments-… | descriptive | media/\*.png | yes | – | `image/png` | code block |

So BHmHNQKJaSWT isn't a representative test. Every figure is a file on disk with a numbered tag and a caption in the code, and the notebook adds nothing the pipeline needs. Chronoferencing fails for mixed reasons, and only one of them (cell 30) involves an output that exists nowhere but the notebook. Side effects in its PDF: 98 pages, and broken "see Figure" links (`No target for internal reference "#figure-average-no-comments-per-post-*"`).

The diagnosis

## Two gaps, not one

What the meeting called a single problem is two. Splitting them matters because the first is cheap to fix and covers far more figures than you'd expect.

article.md already has it

### 1. Recognition gap

The information is in the markdown; jdh-cli just doesn't recognise it.

- Descriptive tags like `figure-cartoon-*`: 162 tags in 16 of 40 articles
- Captions in cell metadata, which Jupytext writes into the fence line: ```` ```python jdh={"object":{"source":["…"]}} tags=[…] ````
- Tables, video and audio tags beyond `table-1`

only article.ipynb has it

### 2. Content gap

The figure itself exists only as an output in the notebook.

- Matplotlib and seaborn charts: `image/png` with no file on disk. The largest group: 202 figure cells
- Dataframes: `text/html` tables in 17 articles
- Interactive charts (Plotly, Bokeh, maps) and embedded video: HTML/JS only, with no static image
- Captions that exist only in output metadata (1 article, `BuWvtJFxh3wy`)

What JDH-001 builds

## The solution

A notebook reader that runs before the figure, table and hermeneutics steps. It gives each tagged cell one resolved record, which the downstream steps render. The markdown stays the text source; the notebook supplies outputs.

1 · match**Pair cells by tag**

Read every tag form, numbered or descriptive. Fall back to cell order when tags repeat or are missing.

2 · classify**Kind from the tag**

`figure`, `table`, `video`, `sound`. Keep `hermeneutics` and size hints (`w-904px`).

3 · caption**Resolve the caption**

Code literal, then cell metadata, then output metadata. Warn when they disagree.

4 · output**Pick one MIME type**

Drop `stream` and `error`. Prefer the original file for `Image()` cells, then `image/*`, `text/markdown`, `text/html`.

5 · hand off**Render downstream**

Images go to JDH-002, tables to JDH-003, interactive output to JDH-004.

### Why the code caption wins

Output metadata is written when the notebook runs. Edits made afterwards, such as copy-editing, reach the code but not the output until the notebook is run again. BHmHNQKJaSWT shows this on figures 3 and 4:

code literal: …one hundred nearest neighbours of three terms…\
output meta: …one hundred nearest neighbors of three terms…

Across the corpus, 19 of 159 cells with both disagree. Preferring output metadata would undo copy edits.

### Caption order

1. `metadata={"jdh":…}` literal in the code: 165 figure cells
2. Cell metadata `jdh.object.source`: 219 cells. Also in the `.md` fence line
3. Output metadata `jdh.object.source`: 197 cells. Notebook only; may be stale

Also fixes a small bug found along the way: today's replacement leaves the original closing fence behind, producing a 6-backtick line after every figure (4 in BHmHNQKJaSWT).

Simulated against 40 published JDH notebooks

## Impact

Each bar counts tagged figure cells that would render as a figure, as the fix lands in layers. Layer A needs only the markdown; B and C need the notebook reader.

Today A · recognise tags and fence captions (markdown only) B · image outputs from the notebook (JDH-002) C · HTML, Plotly, Bokeh (JDH-003/004)

BHmHNQKJaSWT

4 → 4 figures

No visible change; every figure already works. What it gains: a warning on the stale captions for figures 3 and 4, the stream-log rule made explicit (5 hermeneutics cells), and the stray fence removed.

Chronoferencing

0 → 6 → 7 of 7

Layer A alone renders 6 figures with captions and fixes the broken figure links. The pie chart needs the notebook plus a Plotly-to-PNG render (JDH-004).

All 38 articles with figures

4 → 38 fully covered

Articles where every figure renders: 4 today, 9 after layer A, 24 after B, 38 after C. The notebook reader underpins B and C, which are 242 of the 416 figure cells.

Things to decide while building

## Risks and open questions

### Outputs must be committed

The notebook reader only works if authors commit executed notebooks. JDH repos do today (309 MB across 40), but a cleared notebook yields nothing. Warn when a tagged cell has no outputs.

### Stale outputs

An output can be older than the code that made it, as the captions show. Decide whether to flag it or re-execute. Re-executing needs the article's Python environment and data.

### Matching cells

Markdown and notebook cells are paired by tag. Duplicate or missing tags need a fallback on cell order, plus a check that the source text matches.

### Rendering dependencies

Plotly to PNG needs kaleido (Python). Decide whether that belongs in jdh-cli, a pre-build step, or JDH's own tooling.

### Build blocker found along the way

Articles with no Zotero citations write an empty `references.bib` that MyST rejects, which stopped the chronoferencing build. Logged under JDH-005.

Evidence: the meeting transcript; `improve-notebook-figures.ts` at jdh-cli `82e4198`; BHmHNQKJaSWT `article.ipynb`; `jdh-observer/6ig87tC5GKjQ` run through jdh-cli and built to PDF (the only changes were `jdh-cli init` and removing the empty bibliography); and 40 of 42 published JDH notebooks downloaded on 30 Sep 2026. Details: `backlog/JDH-001-notebook-output-reader.md` and `backlog/notes/notebook-outputs-survey.md`.