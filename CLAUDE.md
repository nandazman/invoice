## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec

## Data safety

Six orders were lost on 2026-09-07 (write-up: `docs/2026-09-23/data-loss-rules.md`).
Since 2026-10-02 D1 is the only copy of the data (`docs/2026-10-02/d1-only-plan.md`),
which removed that failure class: the browser keeps nothing durable. The rules
that remain:

- **A destructive confirmation must state the row count**, not just the danger.
- **Apply D1 migrations before deploying** a client that names the new column —
  `migrations/0004_order_modal.sql` explains why. `deploy:cf` does not do this
  for you.
- **Export before hand-written SQL against remote D1**, and before every deploy
  that changes the schema or the write path (`bun run d1:export`, keep it in
  `backup/`).
- **Every mutation goes through `persist()`** (`src/lib/db.ts`) with all the rows
  it changes in ONE batch — the change and its audit entry must land together.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.
