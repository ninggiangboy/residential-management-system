import AsyncStorage from '@react-native-async-storage/async-storage'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

export { persistMeta, shouldPersistQuery } from './persist-rule'

const DAY_MS = 24 * 60 * 60 * 1000

/** `maxAge` of the persisted cache; `gcTime` must be at least this for the persister to keep the entries (DOC-55 §8.1). */
export const PERSIST_MAX_AGE_MS = DAY_MS
export const PERSIST_KEY = 'rms.query-cache'

/**
 * The defaults of DOC-55 §8.1 for the apps: no retry in the library (the fetcher retries), 30 s stale, 24 h kept. A mutation is
 * never queued silently (`networkMode: always`), so a write offline fails at once with "not sent" (DOC-55 §9.1).
 */
export function createAppQueryClient(onError?: (error: unknown) => void): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: PERSIST_MAX_AGE_MS,
        retry: 0,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        networkMode: 'online',
      },
      mutations: { retry: 0, networkMode: 'always' },
    },
  })
}

/**
 * The persister over AsyncStorage. Writes are throttled to one a second (DOC-55 §9.2). The key is one per install and not per
 * account: `clearPersistedCache` runs at every sign-out and before every sign-in, so a second account never reads the first one's
 * data (DOC-55 §5.4).
 */
export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: PERSIST_KEY,
  throttleTime: 1000,
})

export async function clearPersistedCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PERSIST_KEY)
  } catch {
    // The entry expires by `maxAge` and is dropped on a `buster` change.
  }
}
