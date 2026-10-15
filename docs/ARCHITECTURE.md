# Arsitektur, keamanan & aturan bisnis

## Gambaran umum

```
Browser (React SPA / PWA)
   │  cookie sesi httpOnly + header X-CSRF-Token + X-Company-Id
   ▼
Express API  ──  loadSession → csrfProtection → requireAuth → requireCompany → perm('…') → handler
   │                                                        (verifikasi keanggotaan & izin di server)
   ▼
withTenant(companyId): BEGIN; set_config('app.company_id', …, true); …query…; COMMIT
   ▼
PostgreSQL (RLS FORCE + composite FK + EXCLUDE constraint + trigger keuangan)
```

Di produksi API dan web app disajikan dari satu origin (`npm start`). Service worker hanya meng-cache *app shell*. Respons API tidak pernah di-cache (`Cache-Control: no-store`), sehingga data keuangan selalu diambil langsung dari server.

## Keamanan

| Aspek | Implementasi |
|---|---|
| Password | Argon2id (19 MiB, t=2). Kebijakan minimal 10 karakter dengan huruf besar, huruf kecil, dan angka |
| Sesi | Token acak 256-bit, disimpan sebagai hash SHA-256. Cookie `httpOnly`, `SameSite=Lax`, `Secure` (produksi). Masa berlaku *sliding* (`SESSION_TTL_HOURS`). Logout menghapus sesi. Ganti/reset password mengeluarkan sesi lain |
| CSRF | *Synchronizer token* per sesi, wajib di header `X-CSRF-Token` untuk setiap request non-GET |
| Brute force | Rate limit login 20/15 menit per IP. Akun dikunci 15 menit setelah 8 kali gagal. Lupa password selalu memberi respons sama (tidak membocorkan email terdaftar) |
| Otorisasi | RBAC per endpoint (`perm()`), izin per role disimpan per perusahaan. Owner selalu punya semua izin |
| Tenant | Lihat `docs/DATABASE.md` (aplikasi + RLS + composite FK) |
| Input | Validasi Zod di semua endpoint. Query memakai parameter (Drizzle/`sql` template). Kata kunci LIKE di-escape |
| Upload | Maks. 5 MB. Tipe dicek dari *magic bytes* (bukan ekstensi). Gambar di-encode ulang dengan sharp (metadata/EXIF dibuang). PDF divalidasi header. Nama file disanitasi. File disajikan dengan `nosniff` dan hanya kepada anggota perusahaan yang berizin. URL dari file impor tidak diterima sebagai file |
| Header | Helmet: CSP ketat (`script-src 'self'`), HSTS bila HTTPS, `frame-ancestors 'self'`, dsb. |
| Error | Pesan generik ke klien. Detail dicatat hanya di log server. Error database dipetakan ke pesan aman |
| Ekspor CSV | Proteksi *formula injection* (sel diawali `= + - @` diberi apostrof) |
| Audit | Login (berhasil/gagal), reset password, perubahan tarif, transaksi (buat/ubah/serah terima/kembali/selesai/batal), pembayaran/refund/reversal, pengeluaran/void, impor, ekspor laporan, perubahan pengaturan, keanggotaan, dan izin role. Disimpan dengan nilai sebelum/sesudah, IP, dan user agent. Append-only |
| Secrets | Hanya dari environment variables. Tidak ada kredensial di kode |

## Role bawaan

| Role | Ringkasan izin (dapat diubah Owner di *User & Role*) |
|---|---|
| Super Admin | Platform: kelola perusahaan, aktif/nonaktif, keanggotaan. **Tidak** dapat membuka data operasional perusahaan kecuali diundang sebagai anggota |
| Company Owner | Semua izin di perusahaannya (tidak dapat dikurangi) |
| Admin | Semua operasional, keuangan, laporan, ekspor. Tanpa kelola user, pengaturan, audit, reversal, void |
| Finance | Lihat data, pembayaran/refund/reversal, pemasukan, pengeluaran/void, semua laporan, ekspor |
| Operator | Customer, kendaraan, sopir, reservasi, transaksi, serah terima/pengembalian, perawatan, laporan operasional |
| Viewer | Hanya melihat data dan laporan |

Izin khusus `rental.price_override` diperlukan untuk mengubah harga satuan, kuantitas, diskon, atau denda di luar perhitungan otomatis.

## Aturan perhitungan

- **Durasi → unit tagih:** `ceil((menit − toleransi) / unit)` dengan unit harian 24 jam, mingguan 7 hari, bulanan 30 hari, minimal 1. Toleransi default 60 menit (Pengaturan Sistem).
- **Tarif:** diambil dari `vehicle_rates` sesuai jenis rental dan layanan (dengan/tanpa sopir). Nilainya disalin ke transaksi saat dibuat. Perubahan tarif di master tidak mengubah transaksi lama.
- **Total:** `subtotal − diskon + biaya tambahan + denda + kerusakan`, lalu pajak (%) dibulatkan *half-up* ke rupiah penuh (atau 2 desimal). Dihitung di server, dan dijaga oleh constraint database.
- **Denda keterlambatan:** setelah toleransi, per hari yang dimulai × tarif harian (snapshot), atau per jam (konfigurasi). Petugas dengan izin dapat mengubahnya, dan perubahan tercatat.
- **Status pembayaran** (diturunkan, tidak diketik): *Belum dibayar* (0), *DP dibayar* (hanya pembayaran bertanda DP), *Pembayaran sebagian*, *Lunas*, *Perlu pengembalian dana* (dibayar > tagihan).
- **Pembatalan transaksi:** hanya sebelum serah terima. Biaya pembatalan opsional menjadi tagihan. Kelebihan bayar dikembalikan lewat *refund*.
- **Penyelesaian:** otomatis menjadi *Selesai* saat kendaraan sudah kembali dan sisa tagihan 0. Bisa diselesaikan dengan piutang bila pengaturan mengizinkan.

## Definisi akuntansi (dipakai konsisten di dashboard & semua laporan)

| Istilah | Definisi |
|---|---|
| Pendapatan rental | Diakui pada **tanggal mulai sewa**, sebesar total − pajak. Transaksi batal diakui sebesar biaya pembatalan pada tanggal batal |
| Penerimaan kas | Uang yang benar-benar diterima pada **tanggal bayar**: pembayaran − refund − reversal |
| Piutang | Σ sisa tagihan positif semua transaksi (posisi saat ini) |
| Pengeluaran | Pengeluaran berstatus *diposting* pada tanggal pengeluaran (void dikecualikan). Biaya perawatan otomatis menjadi pengeluaran kategori *Servis kendaraan* |
| Laba operasional | Pendapatan rental − pengeluaran pada periode yang sama |

Uang muka yang diterima bulan ini untuk sewa bulan depan dihitung sebagai **penerimaan kas bulan ini** dan **pendapatan bulan depan**. Keduanya tidak pernah dijumlahkan.

## Ringkasan API (`/api`)

| Modul | Endpoint |
|---|---|
| Auth | `POST auth/login`, `POST auth/logout`, `GET auth/me`, `POST auth/forgot-password`, `GET auth/token-info`, `POST auth/reset-password`, `POST auth/change-password`, `PATCH auth/profile` |
| Perusahaan | `GET company`, `PUT company/profile`, `PUT company/settings`, `GET/POST company/members`, `PATCH company/members/:id`, `GET company/roles`, `PUT company/roles/:role`, `cash-accounts`, `expense-categories`, `GET audit-logs` |
| Super Admin | `admin/companies`, `admin/companies/:id/members`, `admin/memberships/:id`, `admin/users`, `admin/audit-logs` |
| Master | `customers` (+`lookup`, `check-duplicates`, `:id/archive`, `:id/restore`), `vehicles` (+`available`), `rates/:vehicleId`, `drivers` |
| Operasional | `reservations` (+`:id/status`, `:id/convert`), `pricing/quote`, `rentals` (+`:id/handover`, `:id/return-preview`, `:id/return`, `:id/complete`, `:id/cancel`), `calendar`, `maintenance` (+`reminders`, `:id/complete`, `:id/cancel`) |
| Keuangan | `payments` (+`:id/reverse`; header `Idempotency-Key`), `receivables`, `expenses` (+`:id/void`), `incomes` (+`:id/void`), `cash-in` |
| Laporan | `GET reports`, `GET reports/:key?from&to&customerId&vehicleId&status&format=json|xlsx|csv` |
| Impor | `GET imports/templates/:entity`, `POST imports/:entity/upload`, `POST imports/:id/validate`, `POST imports/:id/commit`, `GET imports/:id/errors`, `GET imports` |
| File | `POST files` (multipart), `GET files/:id`, `GET attachments` |

## Keterbatasan & catatan

- **ORM:** Drizzle, bukan Prisma (lihat README).
- **PDF:** dokumen dan laporan dibuat sebagai halaman cetak A4/A5 dengan print stylesheet, lalu disimpan sebagai PDF lewat dialog cetak browser. Tidak ada generator PDF di server.
- **Email:** memerlukan SMTP. Tanpa SMTP, tautan reset/undangan dicetak di log server.
- **Satu kendaraan per transaksi.** Sewa beberapa kendaraan dibuat sebagai beberapa transaksi.
- **Jadwal sopir** belum diperiksa bentroknya (hanya kendaraan).
- **Pendapatan** diakui di tanggal mulai sewa, tidak dibagi pro-rata per hari untuk sewa lintas bulan.
- **Rate limit** disimpan di memori proses. Bila menjalankan lebih dari satu instance, gunakan store bersama (mis. Redis).
- **File Docker** belum dijalankan di lingkungan pembangunan.
