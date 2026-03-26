"use client";

/**
 * Central data cache for the dashboard.
 * Fetches and decrypts all household data ONCE, shares across all pages.
 * Eliminates redundant API calls and decryption on every navigation.
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { useEncryption } from "./encryption-context";
import { getDEK } from "./key-store";
import { decryptEntities, decryptEntity } from "./entity-crypto";
import type {
  Transaction,
  Category,
  User,
  Household,
  MerchantRule,
  Settlement,
} from "@/lib/types";

interface DataState {
  transactions: Transaction[];
  categories: Category[];
  users: User[];
  currentUser: User | null;
  household: Household | null;
  merchantRules: MerchantRule[];
  settlements: Settlement[];
  loading: boolean;
  /** Timestamp of last successful fetch */
  lastFetched: number;
}

interface DataContextValue extends DataState {
  /** Re-fetch and re-decrypt everything */
  refreshAll: () => Promise<void>;
  /** Re-fetch only the household */
  refreshHousehold: () => Promise<void>;
  /** Re-fetch only transactions */
  refreshTransactions: () => Promise<void>;
  /** Re-fetch only categories */
  refreshCategories: () => Promise<void>;
  /** Re-fetch only settlements */
  refreshSettlements: () => Promise<void>;
  /** Re-fetch only merchant rules */
  refreshMerchantRules: () => Promise<void>;
  /** Re-fetch only users */
  refreshUsers: () => Promise<void>;
  /** Optimistically update transactions in cache (no re-fetch) */
  updateTransactions: (fn: (prev: Transaction[]) => Transaction[]) => void;
  /** Optimistically update categories in cache */
  updateCategories: (fn: (prev: Category[]) => Category[]) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { isUnlocked } = useEncryption();
  const [state, setState] = useState<DataState>({
    transactions: [],
    categories: [],
    users: [],
    currentUser: null,
    household: null,
    merchantRules: [],
    settlements: [],
    loading: true,
    lastFetched: 0,
  });

  // Prevent concurrent fetches
  const fetchingRef = useRef(false);

  const fetchAndDecrypt = useCallback(
    async (
      urls: Record<string, string>,
      dek: CryptoKey | null
    ): Promise<Partial<DataState>> => {
      const results: Partial<DataState> = {};
      const fetches = Object.entries(urls).map(async ([key, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const raw = await res.json();

          switch (key) {
            case "transactions":
              results.transactions = (await decryptEntities(
                Array.isArray(raw) ? raw : [],
                dek
              )) as unknown as Transaction[];
              break;
            case "categories":
              results.categories = (await decryptEntities(
                Array.isArray(raw) ? raw : [],
                dek
              )) as unknown as Category[];
              break;
            case "users":
              results.users = (await decryptEntities(
                Array.isArray(raw) ? raw : [],
                dek
              )) as unknown as User[];
              break;
            case "currentUser":
              results.currentUser = (await decryptEntity(
                raw,
                dek
              )) as unknown as User;
              break;
            case "household": {
              const decryptedHousehold = (await decryptEntity(
                raw.household,
                dek
              )) as unknown as Household;
              results.household = decryptedHousehold;
              // Members are in raw.members — but we already fetch /api/users
              break;
            }
            case "merchantRules":
              results.merchantRules = (await decryptEntities(
                Array.isArray(raw) ? raw : [],
                dek
              )) as unknown as MerchantRule[];
              break;
            case "settlements":
              results.settlements = (await decryptEntities(
                Array.isArray(raw) ? raw : [],
                dek
              )) as unknown as Settlement[];
              break;
          }
        } catch {
          // Individual fetch failures don't break the whole load
        }
      });

      await Promise.all(fetches);
      return results;
    },
    []
  );

  const refreshAll = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setState((s) => ({ ...s, loading: true }));

    try {
      const dek = getDEK();
      const results = await fetchAndDecrypt(
        {
          transactions: "/api/transactions",
          categories: "/api/categories",
          users: "/api/users",
          currentUser: "/api/user",
          household: "/api/household",
          merchantRules: "/api/merchant-rules",
          settlements: "/api/settlements",
        },
        dek
      );

      setState((s) => ({
        ...s,
        ...results,
        loading: false,
        lastFetched: Date.now(),
      }));
    } catch {
      setState((s) => ({ ...s, loading: false }));
    } finally {
      fetchingRef.current = false;
    }
  }, [fetchAndDecrypt]);

  // Targeted refreshes — only re-fetch what changed
  const refreshTransactions = useCallback(async () => {
    const dek = getDEK();
    const results = await fetchAndDecrypt(
      { transactions: "/api/transactions" },
      dek
    );
    setState((s) => ({ ...s, ...results, lastFetched: Date.now() }));
  }, [fetchAndDecrypt]);

  const refreshHousehold = useCallback(async () => {
    const dek = getDEK();
    const results = await fetchAndDecrypt(
      { household: "/api/household" },
      dek
    );
    setState((s) => ({ ...s, ...results, lastFetched: Date.now() }));
  }, [fetchAndDecrypt]);

  const refreshCategories = useCallback(async () => {
    const dek = getDEK();
    const results = await fetchAndDecrypt(
      { categories: "/api/categories" },
      dek
    );
    setState((s) => ({ ...s, ...results, lastFetched: Date.now() }));
  }, [fetchAndDecrypt]);

  const refreshSettlements = useCallback(async () => {
    const dek = getDEK();
    const results = await fetchAndDecrypt(
      { settlements: "/api/settlements" },
      dek
    );
    setState((s) => ({ ...s, ...results, lastFetched: Date.now() }));
  }, [fetchAndDecrypt]);

  const refreshMerchantRules = useCallback(async () => {
    const dek = getDEK();
    const results = await fetchAndDecrypt(
      { merchantRules: "/api/merchant-rules" },
      dek
    );
    setState((s) => ({ ...s, ...results, lastFetched: Date.now() }));
  }, [fetchAndDecrypt]);

  const refreshUsers = useCallback(async () => {
    const dek = getDEK();
    const results = await fetchAndDecrypt(
      { users: "/api/users", currentUser: "/api/user" },
      dek
    );
    setState((s) => ({ ...s, ...results, lastFetched: Date.now() }));
  }, [fetchAndDecrypt]);

  // Optimistic updates — instant UI, no network roundtrip
  const updateTransactions = useCallback(
    (fn: (prev: Transaction[]) => Transaction[]) => {
      setState((s) => ({ ...s, transactions: fn(s.transactions) }));
    },
    []
  );

  const updateCategories = useCallback(
    (fn: (prev: Category[]) => Category[]) => {
      setState((s) => ({ ...s, categories: fn(s.categories) }));
    },
    []
  );

  // Initial load when encryption is unlocked
  useEffect(() => {
    if (isUnlocked && state.lastFetched === 0) {
      refreshAll();
    }
  }, [isUnlocked, state.lastFetched, refreshAll]);

  return (
    <DataContext.Provider
      value={{
        ...state,
        refreshAll,
        refreshHousehold,
        refreshTransactions,
        refreshCategories,
        refreshSettlements,
        refreshMerchantRules,
        refreshUsers,
        updateTransactions,
        updateCategories,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error("useData must be used within DataProvider");
  }
  return ctx;
}
