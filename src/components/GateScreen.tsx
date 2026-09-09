import { exportAll } from "../lib/backup";
import { downloadJSON } from "../lib/io";
import { Button } from "./Button";

// Shown instead of the whole app when the signed-in Access identity is not on
// the roles list. See docs/2026-08-15/permissions-plan.md §B.
//
// The alternative — letting them in with every editor disabled — was rejected
// because it is an eleven-page sweep against 42 store mutators whose realistic
// failure mode is a locked button on one page and a live one on the next. This
// is one screen, and it either shows or it does not.
//
// It is a UI affordance, NOT the security boundary. Every endpoint re-reads the
// role from D1 on every request and answers 403; nothing in src/worker/ may be
// relaxed on the grounds that this screen stands in front of it.
//
// No nav and no data: there is nothing here they are allowed to do. The one
// exception is the backup, below.
export function GateScreen({ email }: { email: string | null }) {
  // Local data they typed while they still had access is theirs. Taking away
  // the access must not silently take away the ability to get a copy of it —
  // hence the one button on this screen.
  function doBackup() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadJSON(`invoice-backup-${stamp}.json`, exportAll());
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-surface-sunken">
      <div className="w-full max-w-md bg-surface border border-line rounded-xl p-6">
        <div className="text-3xl mb-3">🔒</div>
        <h1 className="text-xl font-bold mb-2">Belum punya akses</h1>

        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-faint font-semibold">
            Masuk sebagai
          </div>
          <div className="text-lg font-bold break-all">
            {email || <span className="text-faint">—</span>}
          </div>
        </div>

        <p className="text-sm text-muted mb-2">
          Email ini sudah lolos Cloudflare Access, tetapi pemilik aplikasi belum
          memberinya akses ke data. Hubungi pemilik aplikasi dan minta email di
          atas didaftarkan.
        </p>
        <p className="text-sm text-muted mb-5">
          Setelah didaftarkan, muat ulang halaman ini — tidak ada kata sandi
          terpisah dan tidak perlu masuk ulang.
        </p>

        <div className="border-t border-line pt-4">
          <p className="text-sm text-faint mb-2">
            Kalau perangkat ini pernah dipakai mencatat, datanya masih tersimpan
            di browser dan bisa Anda salin keluar sekarang.
          </p>
          <Button onClick={doBackup}>💾 Backup semua</Button>
        </div>
      </div>
    </div>
  );
}
