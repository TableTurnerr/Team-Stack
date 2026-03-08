'use client';

import { useState, useEffect, useCallback } from 'react';
import type { SupportedCurrency } from '@/lib/types';

export const SUPPORTED_CURRENCIES: SupportedCurrency[] = [
  'USD', 'PKR', 'GBP', 'EUR', 'AED', 'CAD', 'AUD', 'SGD', 'INR', 'SAR',
];

export const CURRENCY_LABELS: Record<SupportedCurrency, string> = {
  USD: 'US Dollar',
  PKR: 'Pakistani Rupee',
  GBP: 'British Pound',
  EUR: 'Euro',
  AED: 'UAE Dirham',
  CAD: 'Canadian Dollar',
  AUD: 'Australian Dollar',
  SGD: 'Singapore Dollar',
  INR: 'Indian Rupee',
  SAR: 'Saudi Riyal',
};

export const CURRENCY_SYMBOLS: Record<SupportedCurrency, string> = {
  USD: '$',
  PKR: '₨',
  GBP: '£',
  EUR: '€',
  AED: 'د.إ',
  CAD: 'C$',
  AUD: 'A$',
  SGD: 'S$',
  INR: '₹',
  SAR: '﷼',
};

// Rates relative to USD (USD = 1)
const FALLBACK_RATES: Record<SupportedCurrency, number> = {
  USD: 1,
  PKR: 278,
  GBP: 0.79,
  EUR: 0.92,
  AED: 3.67,
  CAD: 1.36,
  AUD: 1.53,
  SGD: 1.34,
  INR: 83.5,
  SAR: 3.75,
};

const CACHE_KEY = 'fin_exchange_rates';
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

interface RatesCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

export function useExchangeRates() {
  const [rates, setRates] = useState<Record<SupportedCurrency, number>>(FALLBACK_RATES);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchRates = useCallback(async () => {
    // Check localStorage cache first
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed: RatesCache = JSON.parse(cached);
        if (Date.now() - parsed.fetchedAt < CACHE_TTL) {
          const mapped = mapRates(parsed.rates);
          setRates(mapped);
          setLastUpdated(new Date(parsed.fetchedAt));
          return;
        }
      }
    } catch {}

    setLoading(true);
    try {
      // Free API: no key required
      const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('API failed');
      const data = await res.json();
      const mapped = mapRates(data.rates);
      setRates(mapped);
      setLastUpdated(new Date());
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        rates: data.rates,
        fetchedAt: Date.now(),
      }));
    } catch {
      // Use fallback silently
      setRates(FALLBACK_RATES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRates();
  }, [fetchRates]);

  // Convert amount from one currency to another
  const convert = useCallback((
    amount: number,
    from: SupportedCurrency,
    to: SupportedCurrency,
  ): number => {
    if (from === to) return amount;
    const fromRate = rates[from] ?? 1;
    const toRate = rates[to] ?? 1;
    // Convert to USD first, then to target
    return (amount / fromRate) * toRate;
  }, [rates]);

  const format = useCallback((
    amount: number,
    currency: SupportedCurrency,
    compact = false,
  ): string => {
    const symbol = CURRENCY_SYMBOLS[currency];
    const absAmount = Math.abs(amount);
    let formatted: string;
    if (compact && absAmount >= 1_000_000) {
      formatted = `${symbol}${(amount / 1_000_000).toFixed(2)}M`;
    } else if (compact && absAmount >= 1_000) {
      formatted = `${symbol}${(amount / 1_000).toFixed(1)}K`;
    } else {
      formatted = `${symbol}${amount.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    return formatted;
  }, []);

  return { rates, loading, lastUpdated, convert, format, refetch: fetchRates };
}

function mapRates(apiRates: Record<string, number>): Record<SupportedCurrency, number> {
  const result = { ...FALLBACK_RATES };
  for (const cur of SUPPORTED_CURRENCIES) {
    if (apiRates[cur] !== undefined) {
      result[cur] = apiRates[cur];
    }
  }
  return result;
}
