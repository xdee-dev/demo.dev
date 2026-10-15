import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button, Modal } from './ui';

/**
 * Shown when the server has no SMTP configured: the activation link cannot be emailed,
 * so the admin copies it and sends it to the person (WhatsApp, chat, etc.).
 */
export function InviteLinkDialog({ link, email, onClose }: { link: string | null; email?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link ?? ''); } catch {
      const el = document.getElementById('invite-link-input') as HTMLInputElement | null;
      el?.select(); document.execCommand('copy');
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Modal open={!!link} onClose={onClose} title="Tautan aktivasi akun"
      footer={<><Button variant="secondary" onClick={onClose}>Tutup</Button><Button icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy}>{copied ? 'Tersalin' : 'Salin tautan'}</Button></>}>
      <div className="space-y-3 text-sm">
        <p>Pengiriman email belum diatur, jadi undangan tidak terkirim otomatis{email ? <> ke <b>{email}</b></> : ''}.</p>
        <p>Salin tautan di bawah dan berikan kepada pengguna (mis. lewat WhatsApp). Pengguna membuka tautan itu untuk membuat password. Tautan berlaku 72 jam dan hanya bisa dipakai sekali.</p>
        <input id="invite-link-input" readOnly value={link ?? ''} onFocus={(e) => e.target.select()} className="input font-mono text-[12.5px]" aria-label="Tautan aktivasi" />
        <p className="text-[12.5px] text-muted">Bila Anda sendiri pemilik email ini, buka tautan tersebut di browser untuk membuat password, lalu login.</p>
      </div>
    </Modal>
  );
}
