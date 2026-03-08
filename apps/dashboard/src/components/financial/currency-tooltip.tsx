'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useExchangeRates, SUPPORTED_CURRENCIES, CURRENCY_SYMBOLS } from '@/hooks/use-exchange-rates';
import type { SupportedCurrency } from '@/lib/types';
import { cn } from '@/lib/utils';

interface CurrencyTooltipProps {
  amount: number;
  currency: SupportedCurrency;
  displayCurrency?: SupportedCurrency;
  children: React.ReactNode;
  className?: string;
}

export function CurrencyTooltip({
  amount,
  currency,
  displayCurrency,
  children,
  className,
}: CurrencyTooltipProps) {
  const { convert, format } = useExchangeRates();
  const [visible, setVisible] = useState(false);
  const [selectedCurrency, setSelectedCurrency] = useState<SupportedCurrency>(
    displayCurrency ?? (currency === 'USD' ? 'PKR' : 'USD')
  );
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const converted = convert(amount, currency, selectedCurrency);
  const otherCurrencies = SUPPORTED_CURRENCIES.filter(c => c !== currency);

  return (
    <div
      className={cn('relative inline-block', className)}
      ref={containerRef}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => { setVisible(false); setDropdownOpen(false); }}
    >
      {children}

      {visible && (
        <div
          ref={tooltipRef}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-52 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] shadow-xl p-3"
          onMouseEnter={() => setVisible(true)}
          onMouseLeave={() => { setVisible(false); setDropdownOpen(false); }}
        >
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 border-b border-r border-[var(--card-border)] bg-[var(--card-bg)]" />

          <p className="text-[11px] text-[var(--muted)] mb-1">Original</p>
          <p className="text-sm font-semibold mb-2">
            {CURRENCY_SYMBOLS[currency]}{amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
          </p>

          <p className="text-[11px] text-[var(--muted)] mb-1">Converted to</p>

          {/* Currency switcher dropdown */}
          <div className="relative mb-1">
            <button
              onClick={(e) => { e.stopPropagation(); setDropdownOpen(o => !o); }}
              className="w-full flex items-center justify-between px-2 py-1.5 text-xs rounded-md border border-[var(--card-border)] bg-[var(--background)] hover:bg-[var(--card-hover)] transition-colors"
            >
              <span>{selectedCurrency} — {CURRENCY_SYMBOLS[selectedCurrency]}{converted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <ChevronDown size={12} />
            </button>
            {dropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-full rounded-md border border-[var(--card-border)] bg-[var(--card-bg)] shadow-lg z-10 max-h-40 overflow-y-auto">
                {otherCurrencies.map(cur => {
                  const amt = convert(amount, currency, cur);
                  return (
                    <button
                      key={cur}
                      onClick={(e) => { e.stopPropagation(); setSelectedCurrency(cur); setDropdownOpen(false); }}
                      className={cn(
                        'w-full text-left px-2 py-1.5 text-xs hover:bg-[var(--card-hover)] transition-colors flex justify-between',
                        cur === selectedCurrency && 'bg-[var(--card-hover)] font-medium'
                      )}
                    >
                      <span>{cur}</span>
                      <span className="text-[var(--muted)]">
                        {CURRENCY_SYMBOLS[cur]}{amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
