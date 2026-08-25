import { useState, useEffect, useCallback, useRef } from 'react';
import API_BASE from '../utils/apiBase';

async function fetchWithRetry(url, opts, retries = 3) {
  // Hold the last 5xx so a persistently-failing server still yields a real
  // Response. Without this the loop could fall through and return undefined,
  // and the caller's `res.ok` then threw "Cannot read properties of undefined
  // (reading 'ok')" — a raw TypeError shown to users in place of the actual
  // error whenever the API was down.
  let lastResponse = null;

  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok || r.status < 500) return r;
      lastResponse = r;
    } catch (e) {
      // Always propagate abort errors immediately — don't retry
      if (e.name === 'AbortError') throw e;
      if (i === retries - 1 && !lastResponse) throw e;
    }
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }

  if (lastResponse) return lastResponse;
  throw new Error('Cannot reach the server. Check your connection and try again.');
}

export default function useAssemblies({ search, searchFields = ['description'], categories, jobIds, preferences, sdcStandards, imageFilter, modelFilter, libraries, statusFilter, updatedAfter, updatedBefore, sortBy, sortOrder, page, limit = 20 }) {
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const abortRef = useRef(null);

  // Debounce search input (instant if empty)
  useEffect(() => {
    if (!search) {
      setDebouncedSearch('');
      return;
    }
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useCallback(async (overridePage = null) => {
    // Cancel previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    const activePage = overridePage ?? page;

    try {
      const params = new URLSearchParams({ sortBy, sortOrder, page: activePage, limit });
      if (debouncedSearch)                       params.set('search',       debouncedSearch);
      if (searchFields && searchFields.length)   params.set('searchFields', searchFields.join(','));
      if (categories   && categories.length)     params.set('categories',   categories.join(','));
      if (jobIds       && jobIds.length)         params.set('jobIds',       jobIds.join(','));
      if (preferences  && preferences.length)    params.set('preferences',  preferences.join(','));
      if (sdcStandards && sdcStandards.length)   params.set('sdcStandards', sdcStandards.join(','));
      if (imageFilter && imageFilter.length)       params.set('imageFilter', imageFilter[0]);
      if (modelFilter && modelFilter.length)       params.set('modelFilter', modelFilter[0]);
      if (libraries   && libraries.length)         params.set('libraries',   libraries.join(','));
      if (statusFilter)                            params.set('statusFilter', statusFilter);
      if (updatedAfter)                            params.set('updatedAfter', updatedAfter);
      if (updatedBefore)                           params.set('updatedBefore', updatedBefore);

      const base = API_BASE;
      const res = await fetchWithRetry(`${base}/api/assemblies?${params.toString()}`, { signal: controller.signal });

      if (!res.ok) {
        // Safely parse error body — server may return HTML on crash
        let message = `Server error (${res.status})`;
        try {
          const body = await res.json();
          message = body.error || body.detail || message;
        } catch {}
        throw new Error(message);
      }

      let json = {};
      try {
        json = await res.json();
      } catch (e) {
        throw new Error('Invalid response from server');
      }
      
      const results = json.data || json.value || [];
      const count   = json.total ?? json.totalRecords ?? 0;

      if (activePage === 1) {
        setData(Array.isArray(results) ? results : []);
      } else {
        setData(prev => {
          const seen = new Set(prev.map(r => r.partno));
          const fresh = (Array.isArray(results) ? results : []).filter(r => !seen.has(r.partno));
          return [...prev, ...fresh];
        });
      }
      setTotal(count);
    } catch (err) {
      if (err.name === 'AbortError') return; // silently ignore aborted requests
      // Friendly message for network failure
      const msg = err.message.includes('Failed to fetch') || err.message.includes('NetworkError')
        ? 'Cannot reach server — check your connection'
        : err.message;
      setError(msg);
    } finally {
      // Only clear loading if this request was NOT aborted
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, searchFields.join(','), categories, jobIds, preferences, sdcStandards, imageFilter, modelFilter, libraries, statusFilter, updatedAfter, updatedBefore, sortBy, sortOrder, page, limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hasMore = data.length < total;

  // Always reloads from page 1 — use after add/save/delete
  const refetch = useCallback(() => fetchData(1), [fetchData]);

  return { data, total, loading, error, hasMore, refetch };
}
