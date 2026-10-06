/** Rotate refresh cookies once for concurrent expired requests; never loop on auth endpoints. */
export const createSessionFetch = (refresh: () => Promise<void>, expired: () => void, fetcher: typeof fetch = fetch) => {
  let pending: Promise<void> | null = null;
  let generation = 0;
  return async (url: string, init: () => RequestInit, allowRefresh = true): Promise<Response> => {
    const startedGeneration = generation;
    const response = await fetcher(url, init());
    if (response.status !== 401 || !allowRefresh) return response;
    if (startedGeneration === generation) pending ??= refresh().then(() => { generation += 1; }).catch((error: unknown) => { expired(); throw error; }).finally(() => { pending = null; });
    try { if (pending) await pending; } catch { return response; }
    const retried = await fetcher(url, init());
    if (retried.status === 401) expired();
    return retried;
  };
};
