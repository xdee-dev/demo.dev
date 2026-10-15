# Database: skema, isolasi tenant, migrasi & backup

PostgreSQL 16+, *shared database / shared schema*. Setiap tabel operasional memiliki `company_id`.

## Tabel

| Kelompok | Tabel |
|---|---|
| Platform | `companies`, `users`, `sessions`, `password_tokens`, `company_memberships` |
| Pengaturan perusahaan | `company_settings` (JSON tervalidasi: pajak, toleransi, denda, metode bayar, format nomor, teks cetak), `role_permissions`, `document_sequences`, `cash_accounts`, `expense_categories` |
| Master data | `customers`, `vehicles`, `vehicle_rates` (harian/mingguan/bulanan × dengan/tanpa sopir), `drivers` |
| Operasional | `reservations`, `rental_transactions`, `vehicle_handovers`, `vehicle_returns`, `vehicle_schedule_blocks`, `maintenance_records` |
| Keuangan | `payments` (pembayaran/refund/reversal), `expenses`, `other_incomes` |
| Pendukung | `file_attachments`, `import_jobs`, `audit_logs` |
| View | `rental_balances`, `reservation_balances` (tagihan, dibayar, sisa, status pembayaran) |

Definisi lengkap ada di `server/src/db/schema.ts`. Aturan tambahan ada di `server/drizzle/0002_rls_constraints.sql`.

## Isolasi antarperusahaan (berlapis)

1. **Aplikasi.** Setiap request terautentikasi memverifikasi keanggotaan aktif user pada perusahaan di header `X-Company-Id`. Semua query tenant berjalan di dalam `withTenant(companyId)` dan memfilter `company_id` secara eksplisit.
2. **Row-Level Security.** Semua tabel tenant memakai `ENABLE` + `FORCE ROW LEVEL SECURITY` dengan policy `company_id = app_current_company()`. Nilai `app.company_id` dipasang dengan `set_config(..., true)`, sehingga hanya berlaku di transaksi request itu dan tidak bocor ke koneksi pool berikutnya. Jika konteks lupa dipasang, hasilnya **0 baris** (gagal tertutup).
3. **Composite foreign key** `(company_id, x_id) → x(company_id, id)`. Pemeriksaan FK biasa melewati RLS, jadi tanpa ini sebuah UUID milik perusahaan lain bisa dirujuk. Dengan composite FK, hal itu ditolak database.
4. **File** disimpan per folder perusahaan dan hanya dilayani lewat endpoint yang memeriksa keanggotaan, RLS, dan izin.

> ⚠️ RLS **tidak berlaku** bagi superuser atau role ber-`BYPASSRLS`. Gunakan role `rental_app` dari `scripts/create-database.sql`. Server produksi menolak start dengan role superuser (override darurat: `ALLOW_RLS_BYPASS_ROLE=true`).

## Integritas data

- **Anti-bentrok jadwal:** `vehicle_schedule_blocks` + `EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (active)`. Kebijakan blok:
  - Reservasi *Menunggu konfirmasi* & *Dikonfirmasi* memblok jadwal. *Draft* tidak memblok, kecuali diaktifkan di Pengaturan Sistem. *Dibatalkan* melepas blok.
  - Transaksi *Terjadwal* & *Sedang disewa* memblok. Setelah kendaraan kembali, blok menyusut ke waktu aktual (pengembalian lebih awal membebaskan jadwal). Transaksi *Dibatalkan* melepas blok.
  - Perawatan *Terjadwal* / *Dikerjakan* memblok. Perawatan tanpa perkiraan selesai memblok sampai ditandai selesai.
  - Transaksi yang **terlambat** dan belum kembali memblok pemesanan baru yang dimulai sekarang.
- **Uang:** `NUMERIC(18,2)`. Constraint `CHECK` memastikan `total = subtotal − diskon + biaya tambahan + denda + kerusakan + pajak`, dan semua nominal ≥ 0.
- **Keuangan tak terhapus:** trigger menolak `DELETE`/`UPDATE` nominal pada `payments` (koreksi = baris *REVERSAL*). `expenses`/`other_incomes` hanya bisa di-*void*. `rental_transactions` & `reservations` tidak bisa dihapus. `audit_logs` bersifat append-only.
- **Nomor dokumen** unik per perusahaan (`UNIQUE (company_id, number)`) dan dialokasikan secara atomik lewat `document_sequences` (UPSERT dengan row lock).
- **Idempotency:** `UNIQUE (company_id, idempotency_key)` pada pembayaran, transaksi, pengeluaran, dan pemasukan.
- **Snapshot historis:** transaksi/reservasi menyimpan `customer_snapshot`, `vehicle_snapshot`, `company_snapshot`, dan tarif saat dibuat, sehingga dokumen lama tidak berubah ketika master data diubah.
- **Soft delete:** customer, kendaraan, dan sopir diarsipkan (`archived_at`), tidak dihapus.
- **Waktu:** semua timestamp `timestamptz` (UTC). Tampilan dan pengelompokan laporan memakai zona waktu perusahaan (WIB/WITA/WIT).

## Migrasi

```bash
npm run db:migrate                          # terapkan semua migrasi yang belum ada
npm run db:generate -w server               # setelah mengubah schema.ts → buat migrasi baru
npx drizzle-kit generate --custom --name=x  # (di folder server) migrasi SQL manual
```

Riwayat migrasi tercatat di tabel `drizzle.__drizzle_migrations`. Saat start, server menerapkan migrasi otomatis (`MIGRATE_ON_START=false` untuk mematikannya).

## Backup & pemulihan

Yang harus di-backup: **database** dan **folder `server/storage`** (foto kendaraan, KTP, bukti bayar).

| OS | Backup | Restore (ke database kosong) |
|---|---|---|
| Windows | `powershell -ExecutionPolicy Bypass -File scripts\backup.ps1` | `scripts\restore.ps1 -Dump backups\rental-db-….dump -Files backups\rental-files-….zip` |
| Linux/macOS | `./scripts/backup.sh` | `./scripts/restore.sh backups/rental-db-….dump backups/rental-files-….tar.gz` |

Skrip menyimpan 30 backup terakhir di folder `backups/`. Jadwalkan harian lewat Task Scheduler (Windows) atau cron (Linux), dan salin folder `backups/` ke lokasi lain (cloud/drive eksternal). Uji restore secara berkala ke database terpisah.

## Pindah ke database terpisah per perusahaan (masa depan)

Karena setiap baris membawa `company_id` dan semua FK bersifat komposit, data satu perusahaan dapat diekspor utuh:

```bash
pg_dump --data-only --table=... "$DATABASE_URL"   # atau COPY (SELECT * FROM t WHERE company_id = '…') TO …
```

Data tersebut lalu dimuat ke database baru dengan skema yang sama. Aplikasi cukup diarahkan ke `DATABASE_URL` perusahaan tersebut.
