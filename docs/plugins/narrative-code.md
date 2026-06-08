---
title: Narrative code
---

# Narrative code

Styles **block-level code shown to the reader** as part of the argument — plain monospace, gray background bleeding to the right page edge, no syntax highlighting.

This plugin has **no directive**. It is a document transform applied to eligible `code` AST nodes at build time.

## When used

| Source | How |
| --- | --- |
| Pipeline | Does not emit anything; untagged fenced blocks from Jupytext pass through |
| Hand-authored | Any `` ```lang `` fence, or `` ```lang tags=["narrative"] `` for explicit intent |

## Eligible code

- Untagged fenced code blocks anywhere in the document
- Fences tagged `narrative` (same styling; tag signals author intent)

Scope includes code inside admonitions, tab sets, tables, etc.

## Excluded code

| Exclusion | Reason |
| --- | --- |
| Code inside `:::{hermeneutics}` | Handled by [hermeneutics](hermeneutics.md) plugin + template |
| `{code-block}` labelled `code:fig:*` | Removed by [hide-figure-code](hide-figure-code.md) |

## Syntax examples

Untagged (most common after Jupytext export):

````markdown
```python
for row in df.itertuples():
    process(row)
```
````

Explicit narrative tag:

````markdown
```python tags=["narrative"]
for row in df.itertuples():
    process(row)
```
````

### Options

No author-facing options. Truncation and typography are controlled by `jdh-theme.code` in `jdh-typst-template` (`max-lines`, `fade-lines`, font size, "N lines more" text).

## Document transform

`wrap-narrative-code-for-typst` wraps each eligible `code` node:

```typst
#narrative-code-block[
  ...code...
]
```

## Typst export

`#narrative-code-block` in `jdh.typ` — gray fill (`#E8E8E8`), right bleed, `spacing: 1em`. Truncation reuses `jdh-theme.code` (shared with hermeneutics code inside cyan blocks).

## Why figure code is excluded

Figure cells are embedding boilerplate (`display(Image(...))`), not narrative code. Gray full-bleed styling would show a redundant code box above every figure. See [hide-figure-code](hide-figure-code.md).
