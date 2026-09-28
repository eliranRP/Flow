# Contributing

This repository holds the product and its documentation. Product behavior is decided in [docs/decisions/](docs/decisions/README.md) and described in the Module 1 spec and the approved design. Application code lives in `app/`, `supabase/`, and `packages/shared`. What that code does today is in [Phase 0](docs/tech/phase-0.md).

Write in English. Use Hebrew only to quote a UI label, and keep the English meaning next to it the first time it matters.

A change that contradicts an accepted decision still starts as a new decision record ([0010](docs/decisions/0010-docs-are-the-source-of-truth.md)). Code that implements a decision already on the books does not need another record. Schema functions still need an explicit `EXECUTE` grant; the rule is in the Phase 0 page.

## Changelog

Every documentation change gets an entry in [docs/changelog.md](docs/changelog.md). Put the newest date first. Use `YYYY-MM-DD`. Say what changed and which decision or screen it affects.

## Decisions

Decisions live in [docs/decisions/](docs/decisions/README.md). The index table in that README is part of the change: update it in the same commit as the record.

### Add a decision

1. Take the next number. Numbers are four digits (`0011`, `0012`, …). Never reuse or renumber a file.
2. Add `docs/decisions/NNNN-short-kebab-title.md`.
3. Use the format in the decisions README: Title, Date, Status (`Accepted`), Context, Decision, Alternatives rejected, Consequences.
4. Link the new file from the index table.
5. Add a changelog entry.

### Supersede a decision

Do not rewrite history by editing an accepted decision into a different one.

1. Add a new numbered record, as above.
2. In the new record, link the old file and say that it supersedes it.
3. In the old file, change `Status` from `Accepted` to `Superseded`, and add a line `Superseded by` with a link to the new record. Leave the original Context, Decision, and Alternatives rejected in place.
4. Update the index: the old row becomes `Superseded`, the new row is `Accepted`.
5. Add a changelog entry that names both numbers.

## Wireframes

Wireframes for Module 1 live in [docs/module-1-project-pnl/wireframes/](docs/module-1-project-pnl/wireframes/README.md).

- Keep the existing file. A new version uses the same stem plus `-v2`, `-v3`, and so on (`06-change-sheet-v2.png`). Do not overwrite an approved or superseded PNG.
- Mark the previous file `Superseded` in `wireframes/README.md` and in [screens.md](docs/module-1-project-pnl/screens.md). The new file is `Approved` once it is the one to build.
- Add a section in `screens.md` for the new file (purpose, main elements, key interactions, and the image). Add the field-level spec as `docs/module-1-project-pnl/screens/NN-name.md` and link it from that section.
- Overview boards are composites. If a board still shows an old screen, say so in the wireframes table. Do not delete it.
- Regenerate from [source/gen.py](docs/module-1-project-pnl/wireframes/source/gen.py) and [source/render.sh](docs/module-1-project-pnl/wireframes/source/render.sh) when the HTML source changes. Commit both the source change and the PNGs.
- Add a changelog entry.

## Screen specs

[screens.md](docs/module-1-project-pnl/screens.md) describes what each wireframe shows. The field-level spec for a screen lives in `docs/module-1-project-pnl/screens/` and is linked from that wireframe's section. Filling one in, or changing one, is a documentation change: update the file and log it in the changelog. If the fill-in contradicts an accepted decision, supersede the decision first.

## Open questions

Unresolved product questions go in [docs/open-questions.md](docs/open-questions.md). When a question is settled, add a decision record, point the question at that record, and log both in the changelog.
