# Rental Management System

Sistem manajemen operasional rental mobil **multi-perusahaan**: reservasi, transaksi sewa, serah terima & pengembalian kendaraan, pembayaran, pengeluaran, perawatan, laporan, impor Excel, dan cetak dokumen. Satu aplikasi melayani banyak perusahaan rental, dan data setiap perusahaan terisolasi ketat.

| Lapisan | Teknologi |
|---|---|
| Frontend | React 19 + TypeScript, Vite, Tailwind CSS 4, TanStack Query, PWA (dapat dipasang) |
| Backend | Node.js 22 + Express 5 + TypeScript, validasi Zod |
| Database | PostgreSQL 16+ dengan **Row-Level Security**, Drizzle ORM + migrasi SQL |
| Keamanan | Argon2id, sesi httpOnly + CSRF token, rate limiting, Helmet/CSP, RBAC per endpoint, audit log append-only |
| File | Upload tervalidasi (magic bytes), gambar di-encode ulang (sharp), akses per perusahaan |
| Impor/Ekspor | XLSX & CSV (ExcelJS, PapaParse); PDF lewat cetak browser |

> **Catatan ORM:** spesifikasi meminta Prisma *atau ORM setara*. Proyek ini memakai **Drizzle ORM**. Mesin Prisma tidak dapat diunduh di lingkungan pembangunan sehingga tidak bisa diuji. Drizzle bersifat type-safe dan tanpa binary engine. Aturan database yang tidak bisa diekspresikan ORM (RLS, constraint anti-bentrok, trigger keuangan) ditulis sebagai migrasi SQL biasa.

## Menjalankan cepat (Windows / macOS / Linux)

Prasyarat: **Node.js 22 LTS** dan **PostgreSQL 16 atau 17**. Langkah lengkap ada di [docs/INSTALL.md](docs/INSTALL.md).

```bash
# 1. Buat role & database (sekali saja, sebagai superuser postgres)
psql -U postgres -f scripts/create-database.sql      # ganti password di file ini dulu

# 2. Konfigurasi
cp .env.example .env          # Windows: copy .env.example .env  → isi DATABASE_URL & SEED_DEMO_PASSWORD

# 3. Instal, migrasi, isi data demo
npm install
npm run db:migrate
npm run db:seed

# 4. Jalankan (API :4000 + web :5173)
npm run dev
```

Buka http://localhost:5173.

### Akun demo (dari `npm run db:seed`)

Semua akun memakai password dari `SEED_DEMO_PASSWORD`; bila kosong, password acak dicetak di terminal.

| Email | Akses |
|---|---|
| `superadmin@rental.local` | Super Admin platform (kelola tenant, tanpa akses transaksi) |
| `owner@nusantara.demo` | Owner — PT Rental Nusantara (data demo terlengkap) |
| `admin@nusantara.demo` / `finance@…` / `operator@…` / `viewer@…` | Role Admin, Finance, Operator, Viewer di PT Rental Nusantara |
| `owner@mobilprima.demo` | Owner — CV Mobil Prima |
| `owner@transportmandiri.demo` | Owner — PT Transport Mandiri (kosong) |
| `multi@demo.local` | Satu email di 3 perusahaan → mencoba **Company Switcher** |

Seed menolak berjalan di `NODE_ENV=production` kecuali `SEED_ALLOW_PRODUCTION=true`. Jangan pakai akun demo di produksi.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Mode pengembangan (hot reload API + web) |
| `npm run build` | Build web (`web/dist`) dan server (`server/dist`) |
| `npm start` | Jalankan build produksi. Server juga menyajikan web app dari origin yang sama |
| `npm run db:migrate` | Terapkan migrasi database |
| `npm run db:seed` / `npm run db:seed -- --reset` | Isi data demo / hapus semua lalu isi ulang (bukan produksi) |
| `npm test` | Unit + integration test (butuh `TEST_DATABASE_URL`; database test **dikosongkan** setiap kali) |
| `npm run typecheck` | Pemeriksaan TypeScript |

## Struktur

```
server/
  drizzle/           migrasi SQL (0002_rls_constraints.sql = RLS, anti-bentrok, trigger keuangan, view saldo)
  src/db/            schema.ts (Drizzle), client, migrate, seed, tenant (withTenant)
  src/auth/          password (Argon2id), middleware sesi/CSRF/tenant/RBAC, daftar izin & role
  src/lib/           money (decimal.js), pricing, numbering dokumen, settings, audit, normalisasi
  src/services/      booking, rental lifecycle, payment, schedule (blok jadwal), company
  src/routes/        endpoint REST per modul
  test/              unit + integration test (vitest + supertest)
web/
  src/pages/         halaman per modul;  src/print/ templat cetak A4/A5
  src/components/    UI kit, DataTable, BookingForm, PaymentDialog, kalender, grafik SVG
docs/                INSTALL, DATABASE, ARCHITECTURE
scripts/             create-database.sql, backup/restore (.ps1 & .sh), init Docker
templates/           template Excel impor customer & kendaraan
```

## Fitur utama & di mana diuji

- **Isolasi perusahaan** berlapis: filter `company_id` di setiap query, **PostgreSQL RLS (FORCE)** yang aktif per transaksi, *composite foreign key* `(company_id, id)` agar ID perusahaan lain tidak bisa dirujuk, dan verifikasi keanggotaan pada setiap request (`test/integration/tenant.test.ts`).
- **Anti-bentrok jadwal**: setiap reservasi aktif, transaksi, dan perawatan membuat blok jadwal. Constraint `EXCLUDE USING gist` menjamin dua blok aktif satu kendaraan tidak pernah tumpang tindih, termasuk pada 6 request bersamaan (`schedule.test.ts`).
- **Akurasi keuangan**: NUMERIC(18,2) di database, decimal.js di server, BigInt-cents di browser. Status pembayaran dihitung dari data, tidak diketik. Pembayaran memakai idempotency key, tidak bisa dihapus/diubah (trigger), dan koreksi lewat *reversal* (`payments.test.ts`).
- **RBAC** 6 role. Izin per role dapat diubah Owner dan diperiksa di backend (`rbac.test.ts`).
- **Impor Excel/CSV**: pemetaan kolom, validasi, deteksi duplikat (dalam file & database), skip/update, pratinjau perubahan, transaksi tunggal, laporan error (`import.test.ts`).
- **Laporan**: 16 laporan dengan definisi akuntansi konsisten, ekspor XLSX/CSV, dan cetak/PDF.
- **Dokumen cetak**: invoice, kwitansi (dengan terbilang), surat reservasi, surat perjanjian sewa, BA serah terima & pengembalian, serta laporan. Semuanya memakai snapshot data saat transaksi.

Hasil uji: server 61 test lulus, web 10 test lulus.

Dokumentasi lanjutan: [Instalasi & deployment](docs/INSTALL.md) · [Database, RLS & backup](docs/DATABASE.md) · [Arsitektur, keamanan & definisi akuntansi](docs/ARCHITECTURE.md)
