---
title: JDH dialogue
---

# JDH dialogue (`jdh-dialogue.mjs`)

Renders JDH dialogue cells as speech bubbles: a numbered "Dialogue N" in the PDF.

## Source

JDH notebooks mark a dialogue as a markdown cell tagged `dialog-*`, containing a table. There is one column per speaker, with the names in the header row, and one row per turn. A silent speaker's cell holds `&nbsp;`. A single-column table is one speaker's quote.

`improveDialogueRegions` replaces the table in each `dialog-*` region with the directive. The region markers stay, so a `hermeneutics` tag on the same cell still wraps it in a hermeneutics block.

````markdown
```{jdh-dialogue}
:label: dlg:worldcup

| Priestar | Aspect |
|------- | ------ |
| So, who do you think about it? Who will win the World Cup? | &nbsp; |
| &nbsp; | Well, Croatia, I hope. |
```
````

| Option | Description |
| --- | --- |
| argument | Optional caption, from the cell's `jdh.object.source` |
| `label` | `dlg:<slug>` from the tag (`dialog-worldcup-*` → `dlg:worldcup`) |

## Output

- **Container:** kind `dialogue`. MyST and Typst number dialogues as their own series, and the caption always shows "Dialogue N".
- **Body:** one Typst call, `#jdh-dialogue(speakers: (...), rows: (...))`, attached by a document-stage transform. Built in the directive, MyST would move it into the caption.
- **Layout:** the template draws each turn as a bubble in its speaker's column; the last speaker's bubbles align right. Dialogues stay in the text flow (not floated), so long ones break between turns.
- **Text:** cell text is plain. HTML entities are decoded, tags dropped and markdown escapes removed.
