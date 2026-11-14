# Themis interface

Themis is a working space for conversations between people and multiple AI assistants. Preserve its chat,
personas, model configuration, files, notes and orchestration workflows. Visual changes must not migrate
or replace user data. The production interface is `team.html`; `design-lab/` is an abandoned exploration.

## Visual system

`team-refinements.css` owns the shared visual tokens and presentation. `team.css` supplies the underlying
component mechanics. Change the existing rules instead of appending another theme stylesheet.

- Local variable **Geist**, including Latin, extended Latin and Vietnamese subsets, from Google Fonts;
  OFL license in `assets/fonts/OFL.txt`. No remote font requests. Code uses the platform's monospace stack.
- Space scale: 4, 8, 12, 16, 24, 32, 48px. Body UI 14px; secondary 12–13px; conversation 15.5px / 1.75;
  surface headings 20px. Semibold is for identity and hierarchy, not whole paragraphs.
- Controls use 8px corners; floating surfaces and collection items use 16px. No gradient, glow or glass.
  Shadows are restricted to floating surfaces. Focus is visible in both themes.
- Primary controls remain at least 44px. Inline mouse actions may use 32px; coarse pointers retain 44px.
- Interaction transitions: 160ms; layout transitions: 220ms; reduced-motion preference disables them.

| Role | Light | Dark |
|---|---|---|
| Application | `#f5f6f7` | `#101214` |
| Reading surface | `#ffffff` | `#17191c` |
| Raised surface | `#ffffff` | `#1e2125` |
| Secondary surface | `#f0f2f4` | `#24282d` |
| Sidebar | `#f6f7f8` | `#111315` |
| Text | `#22272e` | `#e8ebee` |
| Secondary text | `#5f6873` | `#a2abb5` |
| Accent | `#146859` | `#8ad9bf` |
| Text on accent | `#ffffff` | `#102c24` |
| Selected surface | `#e7f2ee` | `#193b31` |
| Error / background | `#ae3047` / `#fff0f2` | `#ff9bb0` / `#3c232c` |
| Warning / background | `#805612` / `#fff5dc` | `#edc482` / `#372e20` |

## Layout and interaction

- One 256px sidebar for navigation and chat history, collapsing to 64px. Below 961px it becomes a drawer.
- Conversation and composer share an 800px maximum column. Long answers use the whole available column;
  code and tables scroll inside it. Consecutive replies by the same person keep their existing grouping.
- Composer separates a full-width draft from attachment, reply routing and send actions. Preserve the
  mention mirror, keyboard behavior, quoted passages and file validation.
- Header actions are a quiet toolbar; active panels have a visible selected state. The session recovery
  control stays separate because it performs an action rather than toggling a panel.
- People is a searchable two-column collection on wide windows, one column on narrow ones. Preserve
  custom/built-in filters, categories, pagination, details, edit and delete eligibility.
- Model configuration uses two columns only for short fields. URL, key and model name remain full width.
- Notes use the same typography, formatting controls and surfaces as chat; floating/resizing behavior stays.
- Workflow uses neutral graph paper, readable nodes and explicit selection. Stored positions, edges,
  branching, review limits and execution behavior remain compatible. Organize uses wider spacing for the
  enlarged nodes. Stage settings and automatic orchestration translate at their own render boundary.
- Errors retain their recovery action and scope. Loading, disabled, empty, hover and focus states use the
  same semantic tokens. Neither color nor motion alone conveys an essential state.

## Validation

See `docs/ui-redesign-review.md`. Accessibility token checks do not imply that every screen has been
independently audited. The external Claude review remains a separate acceptance step.
