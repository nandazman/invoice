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

Six orders were lost on 2026-09-07. Full write-up and the rules that came out of
it: `docs/2026-09-23/data-loss-rules.md`. The short form:

- **Never add a whole-table `clear()` on a synced table** without exporting the
  unsynced rows first. The existing ones are `store.ts` `setOrders`/`setProducts`
  /`setPurchases`/`setStock`/`setBuyers` and `client.ts` `discardLocalChanges`.
  There is no outbox, so a cleared row that never pushed leaves no tombstone, no
  audit entry, and nothing to recover from.
- **A destructive confirmation must state the row count**, not just the danger.
- **Apply D1 migrations before deploying** a client that names the new column —
  `migrations/0004_order_modal.sql` explains why. `deploy:cf` does not do this
  for you.
- **Export before hand-written SQL against remote D1** (`bun run d1:export`,
  keep it in `backup/`).
