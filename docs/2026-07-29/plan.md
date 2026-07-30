# Plan — 2026-07-29

Add **Pembeli** (buyer) to orders.

Three things, in this order:

1. **A `Buyer` entity** — a real table with an id, not a name-keyed row like `tipe`.
2. **`OrderItem.buyerId`**, filled by a `TypeSelect`-shaped inline picker in the
   add-item form, plus a `/pembeli` list page and a `/pembeli/$id` detail page
   with history.
3. **A one-time backfill prompt** for orders that already exist, asked once and
   never again — whichever way it is answered.

> Scope: schema change (`OrderItem` gains one field, one new table), Dexie
> `version(2)`, `BACKUP_VERSION` 3 → 4, two new routes, one new picker. Explicit
> non-goals at the bottom.

## 1. The question: like `kategori`, or its own page?

Both — they are answers to two different questions, and the file to look at is
`db.ts:37`.

```ts
// A product type ("Bar", "Dapur", ...). Legacy shape was a bare string[]; it is
// a table here so it is a row like everything else. No deletedAt: nothing
// deletes types today.
export interface TypeRow {
  nama: string;
}
```

`types` is keyed on `nama` (`db.ts:76`), the store holds it as `string[]`
(`store.ts:23`), and `addType` is a 20-line function whose whole job is
case-insensitive dedup (`store.ts:134`). That is the right shape for six fixed
category labels that nobody renames and nobody deletes.

It is the wrong shape for people:

- **Rename.** `Product.tipe` stores the type's *name* (`types.ts:18`), so
  renaming a type means rewriting every product that points at it. There is no
  code to do that, because types are not renamed in practice. Buyers are —
  "Bu Ani" becomes "Ibu Ani Warung Kopi" the day a second Ani appears.
- **Attributes.** The user already named three: telepon, email, alamat. A
  `TypeRow` has one column and adding a second makes it a `Product` with extra
  steps.
- **Deletion.** `TypeRow` has no `deletedAt`, deliberately. Buyers churn.
- **History.** "Every order Bu Ani ever placed" needs a stable key that survives
  a rename. A name is not one.

So **storage** follows `Product`: uid primary key, `createdAt`/`updatedAt`/
`deletedAt`, its own Dexie table, its own store hooks.

But the **interaction** the user asked about is right. Nobody wants to leave a
half-typed order, navigate to `/pembeli`, create a row, and come back. So the
picker in the add-item form is `TypeSelect`'s exact behaviour — search the list,
or type a name and get `+ Buat pembeli "…"` — while the row it creates is a full
`Buyer`. `TypeSelect.tsx` is copied rather than generalised; see §4.

The dedicated page exists because of the history requirement, and it mirrors a
pair that already works: `PricesPage` lists, `ProductDetailPage` shows one
product's stock, orders and audit trail. `/pembeli` and `/pembeli/$id` are the
same two pages with a different entity.

## 2. Where `buyerId` goes: on the row

There is no `Order` aggregate in this app. An `OrderItem` **is** the order —
`OrdersPage` groups rows by `tanggal` at render time (`OrdersPage.tsx:141-161`)
and that grouping exists nowhere in storage. So `buyerId` goes on `OrderItem`
next to `productId`, because there is no header row to put it on.

Consequences, all acceptable:

- One date can hold rows for several buyers. Correct — that is what actually
  happens.
- "All orders for Bu Ani" is a **filter**, not a schema relation. `useOrderFilter`
  already resolves `Product.tipe` through a Map for exactly this reason
  (`useOrderFilter.ts:70-74`); buyer is the same move, one field closer.
- Adding three rows for one buyer means the picker is set once per *form*, not
  once per row. `AddItemForm` keeps a per-row `tanggal` and `affectsStock`
  (`AddItemForm.tsx:28-35`); buyer sits **above** the row list, applied to every
  row on commit. One buyer per save is how the form is actually used, and a
  per-row buyer picker on a five-row form is five dropdowns to answer one
  question. Splitting a save across two buyers means two saves.

Not creating an `Order` header entity is the largest decision here. It was
discussed and deliberately deferred — see the note in §7.

### `""` means unassigned

`buyerId: ""` — the same convention `productId` already uses for unmatched legacy
rows (`types.ts:35`), read the same way by the same kind of code. Not `null`,
which would put two "absent" values in one codebase, and not `undefined`, which
IndexedDB stores verbatim (`db.ts:200-205` exists because of exactly that trap).

Unassigned rows render as a grey "— tanpa pembeli —" chip that opens the picker,
mirroring the amber `⚠ Nama` treatment for unlinked products
(`OrdersPage.tsx:356-364`). Reuse the idiom, change the colour: an unlinked
product is a data defect, an unassigned buyer is often just the truth.

## 3. The one-time backfill

Every order that exists today has no buyer. The user wants to be asked once,
pick one buyer, and have it applied.

### Asking once means storing that you asked

The tempting check — "prompt while any order has `buyerId === ''`" — is wrong: it
cannot tell *"we never asked"* from *"you answered, and the answer was that these
orders have no buyer"*. It would ask forever.

So a flag in `db.meta`, which already exists for precisely this kind of
bookkeeping (`db.ts:42-47`, `MIGRATED_KEY`):

```ts
const BUYER_BACKFILL_KEY = "buyerBackfill.v1";
```

Answering *either way* stamps it. `readAll()` returns its absence as
`needsBuyerBackfill: boolean` on the `Snapshot`, so the check stays synchronous
like every other store read (`db.ts:122-130`).

**Fresh installs never see it.** `migrateFromLocalStorage` stamps the flag inside
the `hasLegacyData() === false` branch (`db.ts:219-227`) — a new user has no
orders to backfill and a modal asking about them is nonsense.

### Where it appears

On `OrdersPage` mount, not at boot. A modal over a cold app, before the user has
seen a single order, is a question without context. On `/pesanan` the orders it
is asking about are on screen behind it.

Gated on `needsBuyerBackfill && orders.length > 0`. Someone who migrated an empty
localStorage has nothing to assign; stamp the flag and skip silently.

### What it does

Three outcomes, all terminal:

| Action | Writes |
| --- | --- |
| Pick or create a buyer, confirm | `buyerId` on all N live orders, 1 audit entry, flag |
| "Lewati" | flag only |
| Escape / click-outside | **nothing** — asked again next visit |

Escape is deliberately not an answer. A modal that appears unannounced and
permanently commits on a stray keypress is a trap; `Modal.tsx` gives Escape and
click-outside for free and both should mean "not now".

The copy says it is reversible — the per-row picker from §2 can change any of
them afterwards — because that is what makes "apply to all 340 orders" a
reasonable thing to click.

### One audit entry, not N

A 340-row backfill must not put 340 rows in Riwayat; the log is already the
fastest-growing table (`audit.ts:8-11`). `deleteOrders` has the same instinct
today, collapsing bulk deletes to a `(massal)` label (`store.ts:427-435`), but it
still writes one entry per row. Here it is genuinely one entry:
`Pembeli "Bu Ani" diterapkan ke 340 pesanan lama`.

Orders backfilled this way get `updatedAt` bumped. The alternative — leaving
`updatedAt` alone so the table does not suddenly show every order as touched
today — loses the only trace that the row changed. The audit entry is a summary,
not a per-row record, so `updatedAt` is the per-row trace. Bump it.

All of it in one `db.transaction` over `orders` + `audit` + `meta`, the same
shape as `deleteOrders` (`store.ts:437-443`). A half-applied backfill that
stamped the flag would be unrepeatable.

## 4. Why `BuyerSelect` is a copy of `TypeSelect`, not a generalisation

`TypeSelect` is 110 lines and about 80 of them are the dropdown mechanics:
outside-click, filter, Enter-to-create, Escape. Generalising it means a
`labelSingular` prop for `"— pilih tipe —"` / `+ Buat tipe "…"`, an `itemKey` for
`string` vs `Buyer`, and a render prop for the row (buyers show a phone number
under the name; types do not). Three props and a render prop to serve two
callers, and every future change to either has to be justified against the other.

Copy it, name it `BuyerSelect`, let it take `Buyer[]` and return an id. If a
third picker appears, extract then — with three real call sites to design
against.

## 5. Filtering by buyer

`useOrderFilter` gains `pembeli: string` (a buyer id; `""` = unconstrained),
following the `status` precedent exactly: the predicate skips rows with no
`buyerId` field, so `PurchaseItem` needs no caller-side guard
(`useOrderFilter.ts:92-94`). `<FilterBar>` gets a plain `<Select>` over live
buyers — not `BuyerSelect`, for the same reason `Tipe` is not `TypeSelect`
(`tasks.md` 2026-07-19 §3c): creating a buyer while filtering by buyer is
nonsense.

This is what makes the whole feature useful — filter to a buyer on `/excel`, and
the existing copy-text / XLSX / image exports become a per-buyer statement with
no export code touched.

## 6. Backup

`BACKUP_VERSION` 3 → 4, `SUPPORTED_VERSIONS = [2, 3, 4]`, `buyers: Buyer[]` in
`BackupFile`. v2/v3 files are read and upgraded — same policy as today, for the
same reason: *"a backup you cannot restore is not a backup"* (`backup.ts:25-34`).
Upgrading means `buyers: []` and `buyerId: ""` on every order, a second helper
beside `upgradeRows` (`backup.ts:73`).

**A restore does not touch the backfill flag.** The flag says "this installation
has been asked", not "this data has buyers". Restoring a v3 file onto an
installation that already answered leaves buyerless orders and no prompt — which
is right, because the answer was already given and the per-row picker is there.
Restoring onto a fresh install shows the prompt, which is also right.

## 7. Note — the `Order` header entity, deliberately deferred

Considered on 2026-07-29 and dropped. Recorded here so the reasoning survives and
so the next person does not re-run the argument from scratch.

**The idea.** Orders become two levels: an `Order` (tanggal + buyerId + status)
owning `OrderItem` lines. That is the textbook model, and it is where anything
transaction-level belongs — invoice number, payment/DP, discount, ongkir, due
date, and a status that describes the sale rather than each line of it.

**Why it is not needed for this change.** Filtering by pembeli was never an
argument for it. `buyerId` on the row gives a working buyer filter on Pesanan,
Invoice, Excel and Beli Stok through the one shared hook (§5), with no export
code touched. Grouping and display are free either way — `OrdersPage` already
groups at render time (`OrdersPage.tsx:141-161`) and can group by buyer, by date,
or by both without any storage change.

**The one thing row-only cannot represent.** Two separate transactions from the
same buyer on the same day:

```
{tanggal: 2026-07-20, buyerId: ani, produk: Kopi, status: paid}     ← pagi
{tanggal: 2026-07-20, buyerId: ani, produk: Gula, status: paid}     ← pagi
{tanggal: 2026-07-20, buyerId: ani, produk: Teh,  status: pending}  ← sore
{tanggal: 2026-07-20, buyerId: ani, produk: Susu, status: pending}  ← sore
```

Nothing distinguishes the morning sale from the afternoon one, and no filter can
recover it, because the fact was never stored. So: no two separate invoices for
that day, no "invoice #12 lunas, #13 belum", no DP recorded against one and not
the other. Same limitation for any one-fact-per-transaction field — an ongkir
smeared across four lines makes all four line totals lies.

**Revisit when**, and not before, either happens:

1. A buyer places two distinct orders on one day and they need to be told apart.
2. A second transaction-level field is genuinely wanted — invoice number,
   payment, discount, ongkir.

**How to migrate when that day comes: one `Order` per legacy row.** Do not try to
group existing rows into orders by `(tanggal, buyerId)`. That grouping was never
recorded, and a date holding four `paid` rows and two `pending` ones has no
correct header status — it would force inventing a "sebagian" state or silently
misreporting money. One header per existing line records exactly what is actually
known, loses nothing, and keeps `status` meaningful. Legacy data reads as many
single-line orders, which is the truth. New orders get real multi-line headers
from the day the header ships.

**The cost of being wrong here is bounded.** Adding the header later is the same
work as adding it now, applied to more rows. It is not a door that closes — which
is the reason deferring is safe, and the reason this note exists rather than a
schema.

## Not in this change

- **No `Order` header entity** — deferred with a written trigger, see §7.
- **No buyer on `PurchaseItem`.** Beli Stok records what *we* bought; the
  counterpart is a supplier, a different concept with a different page. Adding
  `buyerId` there because the field name fits would be a modelling error.
- **No auto-fill of the invoice template's `{{customer.*}}`.** `template.customer`
  is static text stored per template (`template-types.ts:103`), edited in the
  Inspector (`Inspector.tsx:244-259`), and rendered by token substitution
  (`ElementContent.tsx:25-28`). Wiring a selected buyer into it means deciding
  what happens when a staged set spans two buyers, and that is its own change.
- **No receivables, aging, or per-buyer balance.** `status` is per row
  (`types.ts:41`); "Bu Ani owes 340k" is a sum over pending rows, and a real
  receivables view needs payments, which do not exist as an entity.
- **No merge/dedup of buyers.** Two rows for the same person is a real problem
  and needs a re-point-then-tombstone operation. Later, if it happens.
- **No changes to `excel.ts`, `orderText.ts`, `orderImage.ts`.** Per-buyer output
  is filtering, not a new layout — see §5.
- **No buyer column in the default `OrdersPage` columns.** It ships in `COLUMNS`
  (`OrdersPage.tsx:52-61`) but hidden by default alongside `createdAt`/`updatedAt`
  (`:64`), so existing users' tables do not change width overnight.
