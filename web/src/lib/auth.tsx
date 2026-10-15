import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setCompany, setCsrf, setOnUnauthorized, ApiError } from './api';
import { setTimeZone } from './format';

export interface Membership { companyId: string; name: string; slug: string; logoFileId: string | null; role: string; companyActive: boolean }
export interface User { id: string; email: string; name: string; isSuperAdmin: boolean }
export interface Settings {
  taxPercent: string; graceMinutes: number; lateFeeMode: 'PER_DAY' | 'PER_HOUR'; lateFeePerHour: string; moneyDecimals: 0 | 2;
  requireFullPaymentToComplete: boolean; reservationBlocksDraft: boolean; paymentMethods: { code: string; label: string }[];
  documentFormats: Record<string, { prefix: string; pattern: string; reset: 'NEVER' | 'YEARLY' | 'MONTHLY'; pad: number }>;
  print: { rentalTerms: string; invoiceNotes: string; receiptNotes: string; footerText: string; signatureCompanyLabel: string; signatureCustomerLabel: string; showBankAccounts: boolean; receiptSize: 'A4' | 'A5' };
}
export interface Company {
  id: string; name: string; slug: string; address: string | null; city: string | null; phone: string | null; email: string | null; website: string | null;
  npwp: string | null; bankAccounts: { bank: string; accountNumber: string; accountHolder: string }[]; logoFileId: string | null; timezone: string;
}

interface AuthState {
  loading: boolean;
  user: User | null;
  memberships: Membership[];
  activeCompanyId: string | null;
  company: Company | null;
  settings: Settings | null;
  role: string | null;
  permissions: Set<string>;
  can: (...p: string[]) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchCompany: (id: string) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const STORAGE_KEY = 'rms.activeCompany';
const readStored = () => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } };
const writeStored = (v: string | null) => { try { if (v) localStorage.setItem(STORAGE_KEY, v); else localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeCompanyId, setActive] = useState<string | null>(null);

  const applySession = useCallback((data: { user: User; csrfToken: string; memberships: Membership[] }) => {
    setCsrf(data.csrfToken);
    setUser(data.user);
    setMemberships(data.memberships);
    const stored = readStored();
    const pick = data.memberships.find((m) => m.companyId === stored && m.companyActive)
      ?? (data.memberships.filter((m) => m.companyActive).length === 1 ? data.memberships.find((m) => m.companyActive) : undefined);
    setCompany(pick?.companyId ?? null);
    setActive(pick?.companyId ?? null);
  }, []);

  const refresh = useCallback(async () => {
    try {
      applySession(await api.get('/auth/me'));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
      setUser(null); setMemberships([]); setActive(null); setCompany(null);
    } finally { setLoading(false); }
  }, [applySession]);

  useEffect(() => { refresh(); }, [refresh]);
  const userRef = useRef<User | null>(null);
  userRef.current = user;
  useEffect(() => {
    setOnUnauthorized(() => {
      if (!userRef.current) return; // nobody was logged in: nothing to reset
      setUser(null); setActive(null); setCompany(null); qc.clear();
    });
  }, [qc]);

  const companyQuery = useQuery({
    queryKey: ['company', activeCompanyId],
    queryFn: () => api.get<{ company: Company; settings: Settings; role: string; permissions: string[] }>('/company'),
    enabled: !!user && !!activeCompanyId,
    staleTime: 60_000,
  });
  useEffect(() => { if (companyQuery.data?.company.timezone) setTimeZone(companyQuery.data.company.timezone); }, [companyQuery.data]);

  const permissions = useMemo(() => new Set(companyQuery.data?.permissions ?? []), [companyQuery.data]);

  const value: AuthState = {
    loading: loading || (!!activeCompanyId && companyQuery.isLoading),
    user, memberships, activeCompanyId,
    company: companyQuery.data?.company ?? null,
    settings: companyQuery.data?.settings ?? null,
    role: companyQuery.data?.role ?? null,
    permissions,
    can: (...p) => p.every((x) => permissions.has(x)),
    login: async (email, password) => {
      const data = await api.post<{ user: User; csrfToken: string; memberships: Membership[] }>('/auth/login', { email, password });
      qc.clear();
      applySession(data);
    },
    logout: async () => {
      await api.post('/auth/logout').catch(() => undefined);
      setCsrf(null); setCompany(null); qc.clear();
      setUser(null); setMemberships([]); setActive(null);
    },
    switchCompany: (id) => {
      // Drop every cached query so data from the previous company can never be shown.
      qc.clear();
      setCompany(id); writeStored(id); setActive(id);
    },
    refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
