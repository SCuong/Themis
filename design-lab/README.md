# Themis Design Lab

Three interactive prototypes of one Themis session, in three art directions. Nothing here touches the real extension,
an API or an AI: every reply is mock text played back on a simulated clock.

## Open it

Open `design-lab/index.html` in Chrome (double-click works, no server needed). Switch with the tabs or keys `1` `2` `3`.
Add `?speed=4` to a prototype URL (for example `open-case/index.html?speed=4`) to fast-forward its clock.

| | Folder | Built by |
|---|---|---|
| LÊN SÓNG | `len-song/` | OpenCode |
| OPEN CASE | `open-case/` | Claude |
| PLAYHOUSE | `playhouse/` | Codex |

## Shared, so the comparison is fair

- `shared/mock-data.js`: one session. 5 members, 2 finished rounds with long replies, 2 marked disagreements,
  and one live round. In the live round Linh answers fast, Mai thinks for about 20 s, Vân's Grok fails until you retry,
  and after everyone is done Khoa answers Mai, which opens a third disagreement.
- `shared/engine.js`: `ThemisMock.createRoom()` plays that data. It uses only the four signals real Themis has
  (waiting, streaming, done, error) plus elapsed time. See the header comment for the API.
  `node shared/engine.check.cjs` is its self-check.

## Real vs simulated

Real in the prototypes: choosing members, reading, switching views, the composer (`@Name` or `@all`; mentioned
members reply word by word), selecting a passage to ask for a critique, retry, keyboard shortcuts.

Simulated: there is no AI. Replies to your own messages are templates that echo your question. The Grok error is
scripted, and retry always works. Disagreements are marked in the data, never detected.

## QA

`NODE_PATH=<a node_modules with playwright-core> node design-lab/tools/shoot.cjs <page> [waitMs]` saves desktop (1440)
and phone (375) screenshots to `test-results/design-lab/` and prints console errors.
`tools/open-case.check.cjs` drives OPEN CASE end to end.
