import { useState, type ComponentType, type SVGProps } from "react";
import { useSyncStatus, syncNow, dismissError, type SyncStatus } from "../lib/sync/client";
import { formatDateTimeID } from "../lib/format";
import { AlertIcon, CloudIcon, CloudOffIcon } from "./icons";
import { Button, PrimaryButton } from "./Button";
import { Modal } from "./Modal";

// What the sidebar says about the connection. D1 is the only copy of the data,
// so there is no "synced / not synced" state to report any more: a change either
// reached the server or it was undone in front of the user. The chip therefore
// stays silent while all is well and speaks only when there is something to know.
//
//   menyimpan…  a change is on its way (a second or less)
//   gagal       a change was refused and has been undone — click for the reason
//   offline     the browser has no connection; saving will fail until it returns
//   tidak segar the last refresh failed; what is on screen may be a minute old

interface Chip {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  tone: string;
}

function chipOf(status: SyncStatus): Chip | null {
  if (status.error) {
    return {
      Icon: AlertIcon,
      label: "gagal menyimpan",
      tone: "border-negative-line bg-negative-soft text-negative-text hover:bg-negative-soft-strong",
    };
  }
  if (!status.online) {
    return {
      Icon: CloudOffIcon,
      label: "offline",
      tone: "border-warn-line bg-warn-soft text-warn-text hover:bg-warn-soft-strong",
    };
  }
  if (status.saving > 0) {
    return {
      Icon: CloudIcon,
      label: "menyimpan…",
      tone: "border-line bg-surface text-faint hover:bg-surface-hover",
    };
  }
  if (status.pollError) {
    return {
      Icon: AlertIcon,
      label: "tidak segar",
      tone: "border-warn-line bg-warn-soft text-warn-text hover:bg-warn-soft-strong",
    };
  }
  return null;
}

export function SyncChip({ collapsed }: { collapsed: boolean }) {
  const status = useSyncStatus();
  const [open, setOpen] = useState(false);

  if (!status.available) return null;
  const chip = chipOf(status);
  if (!chip) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={chip.label}
        aria-label={chip.label}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold cursor-pointer transition-colors ${
          chip.tone
        } ${collapsed ? "justify-center px-0" : ""}`}
      >
        <chip.Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate">{chip.label}</span>}
      </button>

      {open && <StatusPanel status={status} onClose={() => setOpen(false)} />}
    </>
  );
}

function StatusPanel({
  status,
  onClose,
}: {
  status: SyncStatus;
  onClose: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await syncNow();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      className="bg-surface rounded-xl w-full max-w-md border border-line p-5"
    >
      <h2 className="text-lg font-bold mb-2">Koneksi ke server</h2>

      {status.error && (
        <p className="mb-3 text-sm font-semibold text-negative-text bg-negative-soft border border-negative-line rounded-lg px-3 py-2">
          {status.error}
        </p>
      )}
      {!status.online && (
        <p className="mb-3 text-sm text-warn-text bg-warn-soft border border-warn-line rounded-lg px-3 py-2">
          Tidak ada koneksi internet. Data tersimpan di server, bukan di
          perangkat ini, jadi perubahan baru baru bisa disimpan setelah koneksi
          kembali.
        </p>
      )}
      {status.pollError && status.online && (
        <p className="mb-3 text-sm text-warn-text bg-warn-soft border border-warn-line rounded-lg px-3 py-2">
          Pembaruan terakhir gagal: {status.pollError}
        </p>
      )}

      <p className="mb-4 text-sm text-faint">
        Terakhir diperbarui:{" "}
        {status.lastPullAt ? formatDateTimeID(status.lastPullAt) : "—"}. Data
        diambil otomatis tiap menit dan saat Anda kembali ke tab ini.
      </p>

      <div className="flex justify-end gap-2">
        {status.error && (
          <Button
            onClick={() => {
              dismissError();
              onClose();
            }}
          >
            Tutup pesan
          </Button>
        )}
        <PrimaryButton onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? "Memuat…" : "Muat ulang data"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}
