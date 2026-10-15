const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

function words(n: bigint): string {
  if (n < 12n) return SATUAN[Number(n)];
  if (n < 20n) return `${words(n - 10n)} belas`;
  if (n < 100n) return `${words(n / 10n)} puluh ${words(n % 10n)}`;
  if (n < 200n) return `seratus ${words(n - 100n)}`;
  if (n < 1000n) return `${words(n / 100n)} ratus ${words(n % 100n)}`;
  if (n < 2000n) return `seribu ${words(n - 1000n)}`;
  if (n < 1_000_000n) return `${words(n / 1000n)} ribu ${words(n % 1000n)}`;
  if (n < 1_000_000_000n) return `${words(n / 1_000_000n)} juta ${words(n % 1_000_000n)}`;
  if (n < 1_000_000_000_000n) return `${words(n / 1_000_000_000n)} miliar ${words(n % 1_000_000_000n)}`;
  return `${words(n / 1_000_000_000_000n)} triliun ${words(n % 1_000_000_000_000n)}`;
}

/** Amount in Indonesian words for receipts: '1250000.50' → 'Satu juta dua ratus lima puluh ribu rupiah lima puluh sen'. */
export function terbilang(amount: string): string {
  const neg = amount.startsWith('-');
  const [i, f = ''] = amount.replace('-', '').split('.');
  const int = BigInt(i || '0');
  const sen = BigInt((f + '00').slice(0, 2));
  let s = int === 0n ? 'nol' : words(int);
  s = `${s} rupiah`;
  if (sen > 0n) s += ` ${words(sen)} sen`;
  s = s.replace(/\s+/g, ' ').trim();
  return (neg ? 'minus ' : '') + s.charAt(0).toUpperCase() + s.slice(1);
}
