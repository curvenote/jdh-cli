---
title: Full-width figures
---

# Full-width figures

Gives every figure image without a width `100%`, so figures reach the right edge of the text like placeholders do.

This plugin has **no directive**. It is a document transform only.

MyST's Typst export gives an image with no width 90% of the column. Placeholders already set `100%` (JDH-023), so figures stopped short of them and of the text. A width the author set (`:width:` on the figure) is kept.
