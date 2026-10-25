import { QueryClient } from '@tanstack/react-query'

/** The defaults of DOC-55 §8.1 for the web CMS: no retry in the library (the fetcher retries), 30 s stale, 10 min kept. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: 0,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        networkMode: 'online',
      },
      mutations: { retry: 0, networkMode: 'always' },
    },
  })
}
