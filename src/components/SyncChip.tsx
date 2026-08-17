import { useState } from "react";
import {
  useSyncStatus,
  syncNow,
  discardLocalChanges,
  type SyncStatus,
} from "../lib/sync/client";
import { TABLES } from "../lib/sync/tables";
import { formatAngka, formatDateTimeID } from "../lib/format";
import { Button, PrimaryButton, DangerButton } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { Stat } from "./Stat";

// The sync affordance in the sidebar. It is a CHIP first and a button second:
// a bare "Sinkronisasi" button says nothing about whether sync is actually
// working, while "☁️ 3 menunggu" answers the question you have before you
// click. The click is only there for the rarer follow-up — the detail, and the
// two actions that force things.
//
// Pulling stays automatic (the 60s poll and the visibility listener in
// client.ts). Nothing here is the mechanism by which sync happens, and the copy
// below is careful never to imply otherwise.

const thClass =
  "text-left px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200";
const tdClass = "px-2.5 py-2 text-sm border-b border-slate-100";

// Indonesian names for the wire table names in tables.ts. Kept out of that file
// on purpose — it is compiled by the Worker too, and the Worker has no UI.
const TABLE_LABEL: Record<string, string> = {
  products: "Produk",
  orders: "Pesanan",
  purchases: "Pembelian",
  stock: "Stok",
  buyers: "Pembeli",
  templates: "Template",
  audit: "Riwayat",
  types: "Tipe",
};

function tableLabel(name: string): string {
  return TABLE_LABEL[name] ?? name;
}

interface Chip {
  icon: string;
  label: string;
  // Colour tracks severity, not state: only the two things worth acting on —
  // a failure and being offline — are warm.
  tone: string;
}

// Ordered worst-first. A failed sync outranks a backlog, because the backlog is
// usually the CONSEQUENCE of the failure and reporting only the count would
// read as "just wait a moment" when waiting will not help.
function chipOf(status: SyncStatus): Chip {
  if (status.error) {
    return {
      icon: "⚠️",
      label: "gagal",
      tone: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
    };
  }
  if (!status.online) {
    return {
      icon: "☁️",
      label: "offline",
      tone: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    };
  }
  if (status.busy) {
    return {
      icon: "☁️",
      label: "menyinkronkan…",
      tone: "border-slate-200 bg-white text-slate-500 hover:bg-slate-100",
    };
  }
  // Before the backlog, because for this account there IS no backlog: the
  // pending rows are not waiting their turn, they are staying put. "3 menunggu"
  // would promise a drain that is never coming.
  if (!status.canPush) {
    return {
      icon: "💾",
      label:
        status.pendingTotal > 0
          ? `${formatAngka(status.pendingTotal)} lokal`
          : "lokal saja",
      // Slate, not amber: this is a setting someone chose, not a fault.
      tone: "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
    };
  }
  if (status.pendingTotal > 0) {
    return {
      icon: "☁️",
      label: `${formatAngka(status.pendingTotal)} menunggu`,
      tone: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    };
  }
  return {
    icon: "☁️",
    label: "tersinkron",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  };
}

export function SyncChip({ collapsed }: { collapsed: boolean }) {
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);

  // The GitHub Pages copy has no Worker behind it, so there is no sync to have
  // a status about. Showing a permanently grey chip there would be inventing a
  // problem the user cannot fix.
  if (!status.available) return null;

  const chip = chipOf(status);
  const title = `Sinkronisasi: ${chip.label}`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={title}
        aria-label={title}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold cursor-pointer transition-colors ${
          chip.tone
        } ${collapsed ? "justify-center px-0" : ""}`}
      >
        <span className="text-base">{chip.icon}</span>
        {!collapsed && <span className="truncate">{chip.label}</span>}
      </button>

      {open && <SyncPanel status={status} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------- the panel ----------

type ActionKey = "sync" | "discard";

function SyncPanel({
  status,
  onClose,
}: {
  status: SyncStatus;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Which action is waiting for confirmation. One slot, not one flag per
  // button: only ever one dialog is on screen.
  const [confirming, setConfirming] = useState<ActionKey | null>(null);
  // "Buang perubahan lokal" is rare and destructive, so it starts folded away.
  // It still lives here rather than on the admin page, because the person who
  // needs it is whoever is looking at a stuck backlog — not necessarily an
  // admin.
  const [advanced, setAdvanced] = useState(false);

  const rows = TABLES.map((t) => ({
    name: t.name,
    count: status.pending[t.name] ?? 0,
  })).filter((r) => r.count > 0);

  // Every action shares one runner so a thrown error can never leave the panel
  // silently unchanged — `busy` comes from the client, not from local state.
  async function run(fn: () => Promise<void>, ok: string) {
    setError(null);
    setNote(null);
    try {
      await fn();
      setNote(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Confirmation is a dialog, never window.confirm(): a native confirm freezes
  // the entire page while it is up — no re-render, no status tick — which is
  // exactly wrong for a panel whose whole job is reporting live state.
  function confirmed() {
    const key = confirming;
    setConfirming(null);
    if (key === "sync") void run(syncNow, "Sinkronisasi selesai.");
    else if (key === "discard")
      void run(
        discardLocalChanges,
        "Perubahan lokal dibuang dan data diambil ulang dari cloud.",
      );
  }

  const diverging = status.pendingTotal;
  // The whole panel changes voice on this: half the copy below promises that
  // changes are on their way to the cloud, and for a local-only account every
  // one of those sentences is false.
  const localOnly = !status.canPush;

  return (
    <Modal
      onClose={onClose}
      className="bg-white rounded-xl p-5 w-full max-w-lg max-h-[90vh] overflow-auto border border-slate-200"
    >
      <h2 className="text-lg font-bold mb-1">Sinkronisasi</h2>
      <p className="text-sm text-slate-500 mb-4">
        {localOnly
          ? "Akun ini disetel menyimpan di perangkat sendiri saja. Data terbaru dari cloud tetap masuk seperti biasa, tapi apa pun yang Anda catat di sini tidak dikirim ke sana dan tidak terlihat oleh orang lain."
          : "Sinkronisasi berjalan sendiri: setiap perubahan dikirim otomatis, dan data terbaru diambil berkala. Halaman ini hanya untuk melihat kondisinya — dan memaksanya kalau sedang buru-buru."}
      </p>

      {localOnly && (
        <p className="mb-4 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <strong>Catatan penting.</strong> Karena tidak ada salinan di cloud,
          data yang hanya ada di perangkat ini akan hilang kalau riwayat
          browser dibersihkan atau perangkatnya diganti. Pakai “Backup semua” di
          menu kiri secara berkala. Kalau seharusnya ikut terkirim, minta admin
          mengaktifkan “Kirim ke cloud” untuk akun ini.
        </p>
      )}

      <div className="flex gap-6 flex-wrap mb-4">
        <Stat
          label="Koneksi"
          value={status.online ? "Online" : "Offline"}
          className={status.online ? "text-emerald-700" : "text-amber-600"}
        />
        <Stat
          label={localOnly ? "Hanya di perangkat ini" : "Menunggu dikirim"}
          value={`${formatAngka(status.pendingTotal)} baris`}
          className={
            localOnly ? "" : status.pendingTotal > 0 ? "text-amber-600" : ""
          }
        />
        {/* Kept as-is for a local-only account rather than blanked: if the flag
            was turned off after some pushes, this timestamp is the cutoff —
            everything up to here is in the cloud, everything since is not. */}
        <Stat
          label="Terakhir dikirim"
          value={status.lastPushAt ? formatDateTimeID(status.lastPushAt) : "—"}
        />
        <Stat
          label="Terakhir diambil"
          value={status.lastPullAt ? formatDateTimeID(status.lastPullAt) : "—"}
        />
      </div>

      {status.pendingTotal > 0 && (
        <>
          <p className="mb-2 text-sm text-slate-500">
            {localOnly
              ? "Baris berikut tersimpan di perangkat ini saja. Selama “Kirim ke cloud” mati, jumlahnya akan terus bertambah — ini bukan antrean yang sedang menunggu, melainkan selisih dengan isi cloud."
              : "Baris berikut sudah tersimpan di perangkat ini dan menunggu giliran dikirim ke cloud."}
          </p>
          <div className="overflow-x-auto mb-4">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={thClass}>Tabel</th>
                  <th className={`${thClass} text-right`}>Baris</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="hover:bg-slate-50">
                    <td className={tdClass}>{tableLabel(r.name)}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>
                      {formatAngka(r.count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {status.pendingTotal === 0 && (
        <p className="mb-4 text-sm text-slate-400">
          {localOnly
            ? "Belum ada perubahan yang dicatat di perangkat ini sejak terakhir disamakan dengan cloud."
            : "Semua data di perangkat ini sudah sama dengan cloud."}
        </p>
      )}

      {status.error && (
        <p className="mb-4 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          Sinkronisasi terakhir gagal: {status.error}
        </p>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        {/* Still offered when local-only, because the pull half is unaffected
            and getting fresh data is exactly what this account still wants.
            Only the label changes, so the button never claims to send. */}
        <PrimaryButton
          onClick={() => setConfirming("sync")}
          disabled={status.busy}
        >
          {localOnly ? "Ambil data terbaru" : "Sinkronkan sekarang"}
        </PrimaryButton>
        {status.busy && (
          <span className="text-sm text-slate-400">Sedang berjalan…</span>
        )}
        <Button className="ml-auto" onClick={onClose}>
          Tutup
        </Button>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-200">
        <button
          onClick={() => setAdvanced((a) => !a)}
          aria-expanded={advanced}
          className="flex items-center gap-1 text-xs uppercase tracking-wide font-semibold text-slate-400 hover:text-slate-600 cursor-pointer"
        >
          <span className="text-[10px] w-3 inline-block">
            {advanced ? "▾" : "▸"}
          </span>
          Lanjutan
        </button>
        {advanced && (
          <div className="mt-3">
            <p className="text-sm text-slate-500 mb-2">
              {localOnly
                ? "Untuk keadaan yang tidak biasa saja: kalau Anda rela membuang semua catatan yang hanya ada di perangkat ini demi menyamakan isinya dengan cloud. Karena akun ini tidak mengirim apa pun ke cloud, yang dibuang tidak bisa diambil kembali dari sana."
                : "Untuk keadaan yang tidak biasa saja: kalau baris di perangkat ini menolak terkirim dan Anda rela membuangnya demi menyamakan isi dengan cloud."}
            </p>
            <DangerButton
              onClick={() => setConfirming("discard")}
              disabled={status.busy}
            >
              Buang perubahan lokal
            </DangerButton>
          </div>
        )}
      </div>

      {note && (
        <p className="mt-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          {note}
        </p>
      )}
      {error && (
        <p className="mt-3 text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {confirming === "sync" && (
        <ConfirmDialog
          title={localOnly ? "Ambil data terbaru?" : "Sinkronkan sekarang?"}
          confirmLabel={localOnly ? "Ya, ambil data" : "Ya, sinkronkan"}
          onConfirm={confirmed}
          onClose={() => setConfirming(null)}
        >
          <p>
            {localOnly
              ? "Data terbaru dari cloud diambil ke perangkat ini. Tidak ada yang dikirim ke arah sebaliknya — akun ini disetel menyimpan di perangkat sendiri saja."
              : "Perubahan yang tersimpan di perangkat ini dikirim ke cloud, lalu data terbaru dari cloud diambil ke perangkat ini. Ini persis sinkronisasi yang biasanya jalan sendiri — tombolnya hanya mempercepat."}
          </p>
          <p>
            Tidak ada yang dihapus, dan baris yang Anda ubah di sini tidak
            ditimpa oleh versi cloud.
          </p>
        </ConfirmDialog>
      )}

      {confirming === "discard" && (
        <ConfirmDialog
          danger
          title="Buang semua perubahan lokal?"
          confirmLabel="Ya, buang perubahan lokal"
          onConfirm={confirmed}
          onClose={() => setConfirming(null)}
        >
          <p className="font-semibold text-red-700">
            {diverging > 0
              ? `${formatAngka(diverging)} baris yang hanya ada di perangkat ini dan belum tersimpan di cloud akan dihapus.`
              : "Semua baris yang hanya ada di perangkat ini dan belum tersimpan di cloud akan dihapus."}
          </p>
          <p>
            Setelah itu seluruh data diambil ulang dari cloud, jadi isi
            perangkat ini akan sama persis dengan isi cloud.
          </p>
          <p className="font-semibold">
            Tidak bisa dibatalkan. Tidak ada salinan yang disimpan lebih dulu —
            kalau masih ragu, batalkan dan tekan “Backup semua” di bawah menu
            kiri.
          </p>
          <p>
            Yang sudah tersimpan di cloud aman: tindakan ini tidak menghapus apa
            pun di sana, dan tidak menyentuh perangkat orang lain.
          </p>
        </ConfirmDialog>
      )}
    </Modal>
  );
}
