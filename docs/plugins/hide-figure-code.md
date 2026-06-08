---
title: Hide figure code
---

# Hide figure code

Removes legacy `{code-block}` nodes labelled `code:fig:*` from the AST before Typst export. A **safety net** for pre-migration or hand-edited articles.

This plugin has **no directive**. It is a document transform only.

## When used

| Source | How |
| --- | --- |
| Pipeline | `improveNotebookFigures` no longer writes `code:fig:*` blocks — only `{figure}` |
| Build time | This transform strips any remaining `code:fig:*` nodes |

## Background (Option B)

Notebook cells tagged as figures (e.g. `tags=["figure-1-*"]`) contain Python that calls `display(Image(...))`. Readers should see the **figure image and caption**, not the boilerplate source.

### Pipeline output (current)

````markdown
```{figure} ./media/figure1.png
:label: fig:1
Caption text
```
````

### Legacy format (removed by this plugin if still present)

````markdown
```{code-block} python
:label: code:fig:1
display(Image("./media/figure1.png", ...))
```

```{figure} ./media/figure1.png
:label: fig:1
Caption text
```
````

Cross-references in prose use `fig:N`. The pipeline rewrites legacy `code:fig:N` / `{ref}`code:fig:1`` links to `fig:N` during `improveNotebookFigures`.

## Behaviour

`hide-figure-code` transform walks the AST bottom-up and **deletes** any node whose `identifier` or `label` starts with `code:fig:`.

### Options

None. Matching is by label prefix only.

| Pattern | Action |
| --- | --- |
| `identifier` starts with `code:fig:` | Remove node |
| `label` starts with `code:fig:` | Remove node |

## Typst export

Prevents `display(Image(...))` source from appearing in the PDF. Only `{figure}` directives render.

## Interactions

- Figure code is excluded from [narrative-code](narrative-code.md) styling (would be removed first anyway).
- Not related to [hermeneutics](hermeneutics.md) or [jdh-table](jdh-table.md).
