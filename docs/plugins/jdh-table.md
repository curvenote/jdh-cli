---
title: JDH table
---

# JDH table

JDH-specific tables with row/column truncation and Typst `tablex` styling. **The only table directive emitted by the improve pipeline.**

Hand-written `:::{table}` directives in article source keep default MyST styling and are unchanged by the pipeline.

## When used

| Source | How |
| --- | --- |
| Pipeline | `improveJupytextTables` converts every `#region` with `table-*` tags |
| Hand-authored | Write `:::{jdh-table}` directly (uncommon; pipeline handles notebook tables) |

## Directive syntax

```markdown
:::{jdh-table} Absolute and relative frequencies of responses
:label: table:1
:max-rows: 4
:header-rows: 2
:align: center

| Header A | Header B |
| --- | --- |
| … | … |
:::
```

Caption is the directive argument (no "Table N:" prefix — numbering is automatic).

## Options

| Option | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `label` | string | **yes** | — | Cross-reference anchor (e.g. `table:1`) |
| `name` | string | no | — | Alias for `label` |
| `max-rows` | number | no | `4` | Data rows shown before "K rows more"; `0` disables truncation |
| `header-rows` | number | no | auto | Rows treated as headers; pipeline sets when > 1 detected |
| `align` | string | no | `center` | Table alignment |
| `class` | string | no | — | CSS class (HTML) |
| `enumerated` | boolean | no | — | Table numbering; alias `numbered` |
| `enumerator` | string | no | — | Custom enumerator; alias `number` |

Pipeline output always includes `:label:`, `:align: center`, and `:header-rows:` when multiple header rows are detected. It does **not** emit `:max-rows:` (plugin default applies).

### Truncation defaults

From `plugins/lib/table-truncate.mjs` (overridable via `jdh-theme.table` in Typst):

| Constant | Value | Meaning |
| --- | --- | --- |
| `DEFAULT_MAX_ROWS` | `4` | Data rows before summary row |
| `DEFAULT_MAX_COLUMNS` | `6` | Visible column budget including ellipsis |

**Column truncation:** when source columns exceed `max-columns`, shows `ceil((n-1)/2)` from the start, an ellipsis column (`…`), and `floor((n-1)/2)` from the end.

## AST behaviour

Mirrors built-in `{table}` AST (`container[kind=table]`) with `data.jdhTable: true`. A document transform truncates rows/columns, rebuilds the table, and replaces the table node with a Typst `raw` block inside a one-child `div`.

## Typst export

Emits `#jdh-table-enter`, `#tablex(...)`, and `#jdh-table-leave` via `#jdh-table-shell`. Styling: zebra rows, bold headers, no gridlines, gray border; "K rows more" is a full-width `tablex` row.

See `jdh-theme.table` in [Typst integration](../typst.md).

## Design spec

Full architecture and decisions: [2026-06-07-jdh-table-design.md](../superpowers/specs/2026-06-07-jdh-table-design.md).
