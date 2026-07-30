# Tasks — 2026-07-29

Add a `Buyer` entity, put `buyerId` on `OrderItem`, and ask once what to do with
the orders that already exist. See `plan.md` for why buyers are a table and not a
`TypeRow`, why `buyerId` sits on the row instead of an `Order` header, and why
`BuyerSelect` is a copy of `TypeSelect` rather than a shared component.

**Order matters:** §1 (schema + store) has to land before anything can render a
buyer, and §4 (backfill) has to land before §5 puts a picker on existing rows —
otherwise the first thing a user does with the picker is fight the prompt.

**Invariants:**

- `buyerId: ""` means unassigned. Never `null`, never `undefined` — `undefined`
  reaches IndexedDB verbatim (`db.ts:200-205`).
- The backfill prompt writes the `meta` flag on **both** answers and on neither
  dismissal. Escape is not an answer.
- The backfill writes **one** audit entry, whatever N is.

## 1. Schema and storage

- [x] `src/lib/types.ts`: `Buyer` interface — `id`, `nama`, `telepon`, `email`,
      `alamat`, `catatan`, `createdAt`, `updatedAt`, `deletedAt`. Strings, `""`
      for empty; only `nama` is required by the UI. Shaped after `Product`
      (`:15-28`), not `TypeRow`.
- [x] `src/lib/types.ts`: `OrderItem` gains `buyerId: string`, documented with
      the same `("" for …)` comment style as `productId` (`:35`).
- [x] `src/lib/types.ts`: `AuditEntry["entity"]` union (`:81`) gains `"buyer"`.
- [x] `src/lib/db.ts`: `db.buyers!: Table<Buyer, string>` and a
      **`this.version(2).stores({ … })`** block. Keep `version(1)` verbatim —
      deleting it breaks upgrades from installed copies. v2 lists only the
      changed tables: `buyers: "id, deletedAt, nama"` and
      `orders: "id, deletedAt, tanggal, productId, status, buyerId"`.
- [x] `db.ts`: Dexie upgrade function on `version(2)` stamping `buyerId: ""` onto
      existing order rows. Without it, live rows carry `undefined` and every
      `buyerId === ""` check silently misses.
- [x] `db.ts`: `Snapshot` gains `buyers: Buyer[]` and
      `needsBuyerBackfill: boolean`; `readAll()` reads `db.buyers` through
      `live()` and resolves the flag from `db.meta.get(BUYER_BACKFILL_KEY)`.
- [x] `db.ts`: export `BUYER_BACKFILL_KEY = "buyerBackfill.v1"` and a
      `markBuyerBackfillDone()` helper. Keep it beside `MIGRATED_KEY` (`:47`) —
      same kind of bookkeeping, same place.
- [x] `db.ts`: in the fresh-install branch of `migrateFromLocalStorage`
      (`:219-227`), put the flag inside the existing transaction. A new install
      has nothing to backfill and must never see the prompt.
- [x] `db.ts`: legacy migration path stamps `buyerId: ""` on migrated orders.
      `withTombstoneField` (`:201`) is the model — spread first, assign after.
- [x] `db.ts`: `purgeTombstones` (`:308`) gains `db.buyers` in its table list.
- [x] `src/lib/store.ts`: `buyers` array, `hydrateStores` fills it, `useBuyers()`
      + `getBuyers()`, `setBuyers()` for restore. Copy the `products` block.
- [x] `store.ts`: `upsertBuyer(b)` and `deleteBuyer(id)`, modelled on
      `upsertProduct` (`:169`) / `deleteProduct` (`:223`) — timestamp handling,
      `diff()` over a `BUYER_FIELDS` list, audit in the same `db.transaction`.
- [x] `store.ts`: `deleteBuyer` does **not** cascade to orders. A deleted buyer's
      orders keep their `buyerId`, and the UI resolves an unknown id to
      "(pembeli dihapus)". Losing which sales belonged to whom because a contact
      was tidied up is worse than a dangling id — and `AuditEntry.entityId` is
      already documented as danglable (`types.ts:78-79`).
- [x] `store.ts`: `setOrderBuyer(id, buyerId)` — single-row, audit entry, one
      transaction. Same shape as `linkOrderProduct` (`:350`), including the
      no-op guard when the value is unchanged.
- [x] `src/lib/bootstrap.ts` needs no change — it passes the whole `Snapshot`
      through (`:41`). Confirm rather than assume.
- [x] `bun run build`. The compiler finds every `OrderItem` literal missing
      `buyerId`: `AddItemForm.tsx:98-112`, `purchaseFromOrder.ts`, and the test
      fixtures in `store.test.ts` / `backup.test.ts` / `excel.test.ts` /
      `orderText.test.ts`.

## 2. Backup v4

- [x] `src/lib/backup.ts`: `BACKUP_VERSION = 4`, `SUPPORTED_VERSIONS = [2, 3, 4]`,
      `buyers: Buyer[]` on `BackupFile`, `getBuyers()` in `exportAll`,
      `setBuyers()` in `importAll`.
- [x] Extend the version comment block (`:25-34`) with the v4 line, in the
      existing style.
- [x] An `upgradeOrders()` helper beside `upgradeRows` (`:73`) stamping
      `buyerId: r.buyerId ?? ""`. Same spread-first rule.
- [x] `data.buyers ?? []` — a v2/v3 file has no such key.
- [x] **Do not** touch the backfill flag in `importAll`. See `plan.md` §6.
- [x] `backup.test.ts`: v3 file restores with `buyers: []` and every order at
      `buyerId: ""`; a v4 file round-trips byte-identically; a `version: 5` file
      is still rejected.

## 3. Buyer pages

- [x] `src/components/BuyerDialog.tsx` (new) — create/edit form over `Modal`,
      copied from `ProductDialog.tsx` structure. Fields: Nama (required),
      Telepon, Email, Alamat, Catatan. No validation beyond a non-empty trimmed
      `nama`; this app does not validate emails anywhere else and should not
      start here.
- [x] `src/routes/BuyersPage.tsx` (new) at `/pembeli` — table of live buyers
      (nama, telepon, email, order count, total), `+ Tambah Pembeli`, row edit
      and delete. Follow `PricesPage.tsx` for layout, `Panel`, and the
      `thClass`/`tdClass` constants.
- [x] Order count and total come from a `Map<buyerId, {count, total}>` built once
      in a `useMemo` over `orders` — not a `filter` per row, which is
      O(buyers × orders) on every render.
- [x] Delete asks for confirmation and says how many orders will keep pointing at
      the deleted buyer.
- [x] `src/routes/BuyerDetailPage.tsx` (new) at `/pembeli/$id` — header with the
      contact fields, stats (total pesanan, total nilai, belum lunas), the
      buyer's orders newest-first, and the audit trail. This is the "still need
      history" requirement. `ProductDetailPage.tsx` is the template, minus the
      stock and konversi panels.
- [x] Not-found state copied from `ProductDetailPage.tsx:82-101`.
- [x] `src/router.tsx`: `buyersRoute` + `buyerDetailRoute`, both in
      `routeTree.addChildren` (`:83-94`).
- [x] `src/routes/RootLayout.tsx`: `{ to: "/pembeli", label: "Pembeli",
      icon: "👥" }` in the `Data` group (`:26-35`), after Pesanan.
- [x] `src/routes/HistoryPage.tsx`: `buyer: "Pembeli"` in `ENTITY_LABELS`
      (`:15-21`). The union is exhaustive — the build fails without it.

## 4. The one-time backfill prompt

- [x] `store.ts`: `useBuyerBackfillPending()` / `dismissBuyerBackfill()` over the
      snapshot flag, as a module-level value + `emit()` like every other store.
      Sync reads only — nothing downstream of `store.ts` becomes async.
- [x] `store.ts`: `backfillOrderBuyer(buyerId)` — `bulkPut` every live order with
      `buyerId` + bumped `updatedAt`, **one** audit entry
      (`Pembeli "X" diterapkan ke N pesanan lama`), and the meta flag, all in one
      `db.transaction` over `orders` + `audit` + `meta`. Model:
      `deleteOrders` (`:412-444`).
- [x] Rows that somehow already have a `buyerId` are left alone — the backfill
      fills blanks, it does not overwrite.
- [x] `src/components/BuyerBackfillDialog.tsx` (new) over `Modal`. States what it
      found ("N pesanan lama belum punya pembeli"), embeds `BuyerSelect` so a
      buyer can be created without leaving, and says the choice is reversible per
      order.
- [x] Two buttons: `Terapkan ke N pesanan` (disabled until a buyer is chosen) and
      `Lewati`. **Both** stamp the flag; only the first writes orders.
- [x] Escape / click-outside writes **nothing** and the prompt returns next
      visit. `Modal` already gives both (`Modal.tsx`); do not add an `onClose`
      that dismisses permanently.
- [x] `OrdersPage.tsx`: render it when `pending && orders.length > 0`.
- [x] When `pending && orders.length === 0`, call `dismissBuyerBackfill()` in an
      effect and show nothing. Nothing to ask about.

## 5. Buyer on orders

- [x] `src/components/BuyerSelect.tsx` (new) — `TypeSelect.tsx` copied, taking
      `Buyer[]` and `value: string` (an id), emitting `onChange(id)` and
      `onCreate(nama)`. Placeholder `— pilih pembeli —`, create row
      `+ Buat pembeli "…"`. Rows show `telepon` under `nama` when set, since
      duplicate names are the reason the field exists. Search matches nama **and**
      telepon.
- [x] Deliberately not a generalised `EntitySelect`. See `plan.md` §4.
- [x] `AddItemForm.tsx`: a buyer picker **above** the row list, one per form, not
      per row (`plan.md` §2). Applied to every built row in `buildRow` (`:89`).
      Optional — an empty buyer builds rows with `buyerId: ""`.
- [x] The picker keeps its value after `commit()` resets the rows (`:126`).
      Consecutive orders for one buyer are the common case; clearing it makes the
      user re-pick every time.
- [x] `AddItemForm.tsx`: `onCreate` calls `upsertBuyer` with a fresh `uid()` and
      selects it, exactly as `ProductDialog.tsx:4,+TypeSelect` does with
      `addType`.
- [x] `OrdersPage.tsx`: `{ id: "buyer", label: "Pembeli" }` in `COLUMNS`
      (`:52-61`) and in `HIDDEN_BY_DEFAULT` (`:64`) — existing users' tables must
      not change shape on upgrade.
- [x] `OrdersPage.tsx`: bump the column-visibility storage key
      `invoice.pesanan.cols.v2` → `.v3`. The stored object is keyed by column id
      and a new id defaults correctly via `COLUMN_DEFAULTS` (`:65`) — **verify**
      that in `columns.ts` before deciding the bump is unnecessary.
- [x] `OrdersPage.tsx`: the buyer cell links to `/pembeli/$id` when set; when
      `""`, a grey `— tanpa pembeli —` button opening the picker, mirroring the
      amber unlinked-product button (`:356-364`) with a different colour. An
      unlinked product is a defect; a buyerless order is often the truth.
- [x] Unknown id (deleted buyer) renders `(pembeli dihapus)` in grey, not a
      broken link.
- [x] `ProductDetailPage.tsx`: buyer column in the Pesanan table (`:267-326`) —
      it is already the place you go to ask "who bought this".

## 6. Filtering

- [x] `src/lib/useOrderFilter.ts`: `pembeli: string` on `FilterValues` (`:18-25`)
      and `EMPTY` (`:27-34`); `FilterableRow` gains `buyerId?: string` (`:12-16`).
- [x] Predicate: `if (pembeli && o.buyerId !== pembeli) return false`, **skipped
      when `o.buyerId === undefined`** — the `status` precedent (`:92-94`), so
      purchases need no caller-side guard.
- [x] `hasFilter` includes `pembeli` (`:102-104`).
- [x] `src/components/FilterBar.tsx`: a plain `<Select>` of live buyers, next to
      `Tipe`. **Not** `BuyerSelect` — creating a buyer while filtering by buyer
      makes no sense, same call as `Tipe` vs `TypeSelect`.
- [x] Still no boolean props on `<FilterBar>`. The buyer select is universal
      (Beli Stok simply matches nothing), so it goes in the component, not in
      `children`.
- [x] Confirm Excel with `Sumber: Beli Stock` is unaffected: `PurchaseItem` has
      no `buyerId`, the predicate skips it, the row survives.

## 7. Tests

- [x] `store.test.ts` — `upsertBuyer` create/update + audit; `deleteBuyer`
      tombstones and leaves order `buyerId` intact; `setOrderBuyer` persists and
      no-ops on an unchanged value; `backfillOrderBuyer` writes N orders, exactly
      **one** audit entry, and the meta flag; a second call after the flag is set
      is a no-op.
- [x] `store.test.ts` — `backfillOrderBuyer` does not overwrite an order that
      already has a buyer.
- [x] `db.test.ts` — a v1 database upgrades to v2 with `buyerId: ""` on existing
      orders; a fresh install lands with the backfill flag already set.
- [x] `backup.test.ts` — the three cases in §2.
- [x] Run with **`bun run test`**, not `bun test`. The latter invokes Bun's own
      runner instead of Vitest and fails the suite with `IndexedDB API missing`
      because it skips the jsdom + fake-indexeddb setup. `package.json` maps
      `test` to `vitest run`.
- [x] `bun run build`.

## 8. Deviations from the plan — decided during implementation

- [x] **The column-visibility storage key was NOT bumped.** `tasks.md` §5 listed
      `invoice.pesanan.cols.v2` → `.v3` as a checkbox conditional on verifying
      `columns.ts` first. Verified: `usePersistentVisibility`
      (`columns.ts:12-23`) rebuilds state as `saved[id] ?? defaults[id]` over
      `Object.keys(defaults)`, so a column id absent from a stored object
      resolves to its default (`false` for `buyer`), never `undefined`. Bumping
      would have been strictly worse — it discards every existing user's saved
      createdAt/updatedAt preferences to fix a problem that does not exist.
      **Closed as verified-unnecessary, not done.**
- [x] **`backfillOrderBuyer` was not idempotent.** Found by the tests, not by
      review. It had no `if (!buyerBackfillPending) return;` guard, so a second
      call found zero blank orders, correctly skipped the `bulkPut` — and still
      appended `Pembeli "X" diterapkan ke 0 pesanan lama` to the audit log and
      re-stamped the flag. Guard added; the test that pinned the defect is now a
      passing assertion of the correct behaviour.
- [x] **`needsBuyer(o)` extracted to `store.ts`.** The rule "this order still
      needs a buyer" was written once in `backfillOrderBuyer` and once in
      `OrdersPage` to count what the prompt would affect. Two expressions of one
      rule, free to drift into a dialog that promises a different N than the
      write delivers. One exported predicate now.
- [x] **The prompt gates on `withoutBuyer > 0`, not `orders.length > 0`.** As
      specified it would have offered to stamp zero rows on an install where
      every order already had a buyer. "No orders" and "no orders lacking a
      buyer" are the same question; both now answer silently.
- [x] `BuyerSelect` carries a `— tanpa pembeli —` row when a buyer is set, so an
      assignment can be cleared inline. Not specified; `setOrderBuyer` already
      accepted `""` and there was no other way to reach it from the UI.
- [x] `BuyersPage` gained a search box over nama/telepon/email. Not specified.
      Kept — a contact list grows unbounded, unlike the type list.

## Checks

- [ ] Upgrading an existing install: orders survive, the prompt appears **once**
      on `/pesanan`, and does not return after either answer.
- [ ] Escape on the prompt writes nothing; it comes back on the next visit.
- [ ] "Terapkan" on N orders puts exactly one row in Riwayat, not N.
- [ ] A fresh install (clear IndexedDB + localStorage) never shows the prompt.
- [ ] Creating a buyer from inside `AddItemForm` selects it immediately and it
      appears on `/pembeli`.
- [ ] The buyer picker keeps its value across consecutive saves.
- [ ] Deleting a buyer leaves their orders visible with `(pembeli dihapus)`, and
      `/pembeli/$id` for that id shows the not-found panel.
- [ ] Filter by buyer on `/excel` → copy text / XLSX / image contain only that
      buyer's rows, with no export code changed.
- [ ] Backup on v4, restore on a fresh install: buyers and `buyerId` both survive.
- [ ] Restore a **pre-existing v3** backup file: no crash, `buyers` empty, orders
      at `buyerId: ""`.
- [ ] Column toggle: Pembeli is off by default and stays off after a reload.
