---
title: Hermeneutics
---

# Hermeneutics

Mark blocks of commentary (prose, code, or mixed) as **hermeneutic** — interpretive material distinct from the main narrative.

## When used

| Source | How |
| --- | --- |
| Pipeline | `improveHermeneuticsBlocks` wraps Jupytext `#region` or fenced cells tagged `hermeneutics` |
| Hand-authored | Write `:::{hermeneutics}` directly in `article.md` |

## Directive syntax

````markdown
:::{hermeneutics}
This passage interprets the preceding evidence…

```python
# code inside hermeneutics blocks is allowed
print("excerpt")
```
:::
````

### Options

The `hermeneutics` directive has **no options**. The body is parsed as MyST (prose, citations, fenced code, etc.).

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| body | MyST content | yes | — |

## AST behaviour

The directive emits `block[kind=hermeneutics]` with the parsed body as children.

## Document transform

`wrap-hermeneutics-for-typst` wraps each hermeneutics block with Typst raw nodes:

```typst
#hermeneutics-block[
  ...content...
]
```

## Typst export

`#hermeneutics-block` in `jdh.typ` — cyan fill, right bleed. Code inside the block gets optional sidebar markers ("HERMENEUTICS CODE EXCERPT / END"). Truncation for code inside uses `jdh-theme.code` (shared with narrative code).

## Interactions

- Code inside `:::{hermeneutics}` is **excluded** from the [narrative-code](narrative-code.md) transform.
- Not related to figure or table directives.
