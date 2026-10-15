# Panduan instalasi & deployment

## 1. Prasyarat

| Komponen | Versi | Catatan |
|---|---|---|
| Node.js | **22 LTS** (minimal 20.19) | https://nodejs.org — pilih "LTS" |
| PostgreSQL | **16 atau 17** | Windows: installer EDB (https://www.postgresql.org/download/windows/), sertakan *pgAdmin* & *Command Line Tools* |
| Git (opsional) | apa saja | untuk mengelola versi kode |

Pastikan `node -v`, `npm -v`, dan `psql --version` berjalan di terminal (PowerShell/Command Prompt). Di Windows, tambahkan `C:\Program Files\PostgreSQL\16\bin` ke PATH bila `psql` tidak dikenali.

## 2. Siapkan database

Aplikasi **wajib** terhubung memakai role PostgreSQL **non-superuser**. Superuser mengabaikan Row-Level Security, sehingga lapisan isolasi di database tidak berlaku. Di mode produksi server menolak start bila role-nya superuser.

1. Buka `scripts/create-database.sql`, lalu ganti `GANTI_PASSWORD_INI` dengan password yang kuat.
2. Jalankan sebagai superuser `postgres`:
   ```powershell
   psql -U postgres -f scripts\create-database.sql
   ```
   Alternatifnya, buka pgAdmin → Query Tool, tempel isi file, lalu Execute.

Hasilnya: role `rental_app` (pemilik database), database `rental_db`, dan database `rental_test` untuk test otomatis.

## 3. Konfigurasi `.env`

```powershell
copy .env.example .env
```

Isi minimal:

```
DATABASE_URL=postgres://rental_app:PASSWORD_ANDA@localhost:5432/rental_db
TEST_DATABASE_URL=postgres://rental_app:PASSWORD_ANDA@localhost:5432/rental_test
APP_URL=http://localhost:5173
SEED_DEMO_PASSWORD=DemoRental2026
```

Bila password mengandung karakter khusus (`@ : / # ?`), tulis dalam bentuk URL-encoded (mis. `@` → `%40`). Di file `.env`, tanda `#` memulai komentar, jadi hindari `#` atau gunakan URL-encoding `%23`.

## 4. Instal & jalankan (pengembangan)

```powershell
npm install
npm run db:migrate
npm run db:seed          # data & akun demo (opsional)
npm run dev
```

- Web: http://localhost:5173, API: http://localhost:4000. Vite meneruskan `/api` ke API.
- Untuk mengakses dari HP di jaringan yang sama, jalankan `npm run dev -w web -- --host`, lalu buka `http://IP-KOMPUTER:5173`.
- Tanpa SMTP, email reset password dan undangan dicetak di terminal server. Salin tautannya dari sana.

## 5. Menjalankan test

```powershell
npm test
```

Server: 61 test (unit perhitungan uang/durasi/denda, isolasi tenant termasuk RLS & composite FK, autentikasi, RBAC, bentrok jadwal termasuk request bersamaan, pembayaran/idempotency/reversal, impor). Web: 10 test (format rupiah, input nominal, zona waktu, terbilang).
`TEST_DATABASE_URL` harus menunjuk ke database yang namanya mengandung kata "test", karena database tersebut **dihapus isinya** setiap kali test berjalan.

## 6. Produksi — satu server (Windows atau Linux)

```bash
npm ci
npm run build
# .env produksi:
#   NODE_ENV=production
#   APP_URL=https://rental.domainanda.co.id
#   TRUST_PROXY=1            (bila di belakang nginx/Caddy/IIS)
#   SMTP_HOST=... SMTP_USER=... SMTP_PASS=... MAIL_FROM=...
npm start                  # migrasi otomatis, lalu API + web di PORT (default 4000)
```

Server Node menyajikan web app (`web/dist`) dari origin yang sama, sehingga tidak perlu konfigurasi CORS.

### HTTPS (wajib di produksi)

Cookie sesi bertanda `Secure` di produksi, jadi aplikasi **harus** diakses lewat HTTPS. Pasang reverse proxy:

**Caddy** (sertifikat otomatis), `Caddyfile`:
```
rental.domainanda.co.id {
    reverse_proxy 127.0.0.1:4000
}
```

**nginx**:
```nginx
server {
    listen 443 ssl http2;
    server_name rental.domainanda.co.id;
    ssl_certificate     /etc/letsencrypt/live/rental.domainanda.co.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/rental.domainanda.co.id/privkey.pem;
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Pemakaian hanya di jaringan kantor tanpa HTTPS memang memungkinkan dengan `COOKIE_SECURE=false`, tetapi **tidak disarankan**.

### Menjaga proses tetap hidup

- **Linux:** systemd (`ExecStart=/usr/bin/npm start`, `WorkingDirectory=/opt/rental`, `Restart=always`) atau PM2 (`pm2 start npm --name rental -- start`).
- **Windows:** PM2 (`npm i -g pm2 pm2-windows-startup`), atau NSSM untuk mendaftarkan `npm start` sebagai Windows Service.

## 7. Produksi — Docker

`Dockerfile` dan `docker-compose.yml` disertakan (PostgreSQL 16 + aplikasi; role non-superuser dibuat otomatis oleh `scripts/docker-init-db.sh`).

```bash
# .env: POSTGRES_ADMIN_PASSWORD=..., POSTGRES_PASSWORD=..., APP_URL=https://..., SMTP_*
docker compose up -d --build
```

Aplikasi terbuka di `127.0.0.1:4000`. Pasang reverse proxy HTTPS di depannya seperti contoh di atas. Volume `pgdata` dan `storage` wajib ikut di-backup.
Catatan: file Docker belum dapat dijalankan di lingkungan pembangunan (registry Docker Hub tidak terjangkau). Uji sekali di server Anda sebelum dipakai.

## 8. Akun pertama di produksi (tanpa data demo)

1. Jalankan `npm run db:migrate`.
2. Buat Super Admin pertama:
   ```sql
   -- di psql sebagai rental_app
   INSERT INTO users (email, name, is_super_admin) VALUES ('anda@domain.co.id', 'Nama Anda', true);
   ```
3. Buka `/forgot-password`, masukkan email tersebut, lalu buka tautan yang dikirim (atau yang tercetak di log server bila SMTP belum diatur) untuk membuat password.
4. Login → menu **Super Admin** → *Perusahaan baru*. Owner perusahaan menerima undangan untuk membuat password.

## 9. Pembaruan versi

```bash
# backup dulu (lihat docs/DATABASE.md)
git pull            # atau salin kode baru
npm ci && npm run build
npm start           # migrasi baru diterapkan otomatis saat start
```
