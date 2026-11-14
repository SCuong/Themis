# UI redesign review handoff

Working directory: `C:\Users\scuong\.buddylist\worktrees\Themis\themis-6`.
Branch: `themis-wow-ui-reimagine`. No commit, push, merge or deployment performed.
Existing `design-lab/` work is preserved and is not the redesigned application.

## Run the real extension

```powershell
npm run build
node scripts/ui-review.cjs --open
```

This opens Playwright Chromium with `dist/` unpacked in a **new isolated profile**. It seeds the real
extension's storage, drives the real UI and background, checks persistence, then leaves the review window
open. Close that window to end the command. It does not read or modify a personal browser profile.
External provider frames are served inert documents so the review sends no real AI requests.

For automated screenshots and assertions without leaving a window open:

```powershell
node scripts/ui-review.cjs
```

To try with existing accounts, reload the unpacked `dist/` extension from Chrome's extension manager.
That is optional; it is not necessary for reviewing the UI and should not be used to overwrite a profile
or import test data into personal storage.

## Evidence collected by Codex

- `npm run build`: passed. Existing large-chunk build advisory remains.
- `npm run check`: passed.
- `npm test`: **88 passed, 0 failed**. Includes mention routing, attachments and viewers, keyboard focus,
  dialogs, themes, layouts at 320/375/768/960/1440/1920px, translations and workflow connections.
- `node scripts/ui-review.cjs`: **72 screenshots**, 4 combinations of 1440/375px, light/dark, Vietnamese/English,
  using the unpacked extension and its real background/storage. No application JavaScript exceptions.
- Real storage checks: an unaddressed local message and an edited note survive reload; the original
  three seed messages remain; the local message has zero AI recipients.
- Workflow labels created after opening the dialog are now translated; a browser regression assertion
  verifies Vietnamese node type/name, task placeholder and review criteria.
- Mechanical Impeccable scan reports only the subjective "overused font" warning for the three Geist
  subset declarations. Geist is an intentional choice for this functional application, supported offline.

Screenshots and generated profiles are in gitignored `test-results/` and must not be committed.

| Screen | Before, same UI fixture | After, same UI fixture |
|---|---|---|
| Chat | `test-results/before/1440-light-chat.png` | `test-results/after/1440-light-chat.png` |
| People | `test-results/before/1440-light-people.png` | `test-results/after/1440-light-people.png` |
| Models | `test-results/before/1440-light-models.png` | `test-results/after/1440-light-models.png` |
| Workflow | `test-results/before/1440-light-orchestration-flow.png` | `test-results/after/1440-light-orchestration-flow.png` |
| Narrow dark chat | `test-results/before/375-dark-chat.png` | `test-results/after/375-dark-chat.png` |

The real-extension captures are in `test-results/ui-review/`; `summary.json` lists measured bounds,
checks and exceptions. These include populated/empty People, persona editor, member model picker,
Models, Markdown with a long code line and table, Notes, All Notes, workflow/settings, automatic
orchestration and file viewer. Existing regression captures in `test-results/after/` also include
chat creation, group templates, temporary people, workflow templates, loading, error and empty chat.

## Independent review still required

Claude should operate the app independently, not just read the CSS or accept the screenshots as a pass.
Record each finding with screen/state, viewport/theme/language, observed defect, severity and a
reproduction. Distinguish functional/accessibility defects from preferences. Recheck fixes in the app.

Review especially long names, lower-screen popovers, file viewer plus members, stacked dialogs,
large Markdown, long histories, narrow workflow scrolling and appearance/language changes while
a dialog is open. Full real-provider sending/reading has not been rerun: adapters and delivery logic
are unchanged, and the review deliberately uses no real accounts or AI quota.
