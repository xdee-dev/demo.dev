import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { useToast } from '../components/Toast';

/** Field errors from a 400 response, keyed by field path. */
export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  return {
    errors,
    clear: () => setErrors({}),
    set: setErrors,
    fromError: (e: unknown) => { if (e instanceof ApiError && e.details?.fields) setErrors(e.details.fields as Record<string, string>); },
  };
}

/** Mutation that shows a toast, invalidates queries and surfaces field errors. */
export function useAction<TArgs, TRes>(fn: (a: TArgs) => Promise<TRes>, opts: { success?: string | ((r: TRes) => string); invalidate?: string[]; onSuccess?: (r: TRes) => void; fieldErrors?: ReturnType<typeof useFieldErrors> } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onMutate: () => opts.fieldErrors?.clear(),
    onSuccess: (r) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      // Invalidate everything for the active company by default — cheap and keeps all modules consistent.
      if (opts.invalidate) opts.invalidate.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      else qc.invalidateQueries();
      opts.onSuccess?.(r);
    },
    onError: (e) => { opts.fieldErrors?.fromError(e); if (!(e instanceof ApiError && e.code === 'DUPLICATE_CANDIDATE')) toast.error(e); },
  });
}
