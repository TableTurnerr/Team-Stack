'use client';

import { useState } from 'react';
import { X, Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { pb } from '@/lib/pocketbase';
import { COLLECTIONS, type Company } from '@/lib/types';
import { sanitizeFilterValue } from '@/lib/utils';
import {
  generateLeadsCSV,
  downloadCSV,
  fetchPhoneNumbersForCompanies,
  fetchCallStatsForCompanies,
  type ExportOptions,
  type CompanyCallStats,
} from '@/lib/csv-utils';
import type { PhoneNumber } from '@/lib/types';

type Stage = 'config' | 'fetching' | 'done' | 'error';

interface ExportLeadsModalProps {
  isOpen: boolean;
  onClose: () => void;
  companiesCount: number;
  searchFilter: string;
}

export function ExportLeadsModal({ isOpen, onClose, companiesCount, searchFilter }: ExportLeadsModalProps) {
  const [stage, setStage] = useState<Stage>('config');
  const [fetchProgress, setFetchProgress] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [scope, setScope] = useState<'all' | 'filtered'>(searchFilter ? 'filtered' : 'all');
  const [options, setOptions] = useState<ExportOptions>({
    includePhoneNumbersJson: true,
    includeCallStats: true,
    includeReferenceIds: false,
  });

  if (!isOpen) return null;

  const handleClose = () => {
    setStage('config');
    setFetchProgress('');
    setErrorMessage('');
    onClose();
  };

  const handleExport = async () => {
    setStage('fetching');
    setFetchProgress('Fetching companies...');

    try {
      // 1. Fetch companies
      const safeSearch = sanitizeFilterValue(searchFilter);
      const companies = await pb.collection(COLLECTIONS.COMPANIES).getFullList<Company>({
        sort: '-created',
        ...(scope === 'filtered' && safeSearch
          ? { filter: `company_name ~ "${safeSearch}" || owner_name ~ "${safeSearch}"` }
          : {}),
      });

      const ids = companies.map(c => c.id);

      // 2. Fetch phone numbers
      let phoneMap = new Map<string, PhoneNumber[]>();
      if (options.includePhoneNumbersJson) {
        setFetchProgress('Fetching phone numbers...');
        phoneMap = await fetchPhoneNumbersForCompanies(ids);
      }

      // 3. Fetch call stats
      let callStatsMap = new Map<string, CompanyCallStats>();
      if (options.includeCallStats || options.includeReferenceIds) {
        callStatsMap = await fetchCallStatsForCompanies(ids, (current, total) => {
          setFetchProgress(`Fetching call stats (${current}/${total} batches)...`);
        });
      }

      // 4. Generate and download
      setFetchProgress('Building CSV...');
      const effectiveOptions: ExportOptions = {
        includePhoneNumbersJson: options.includePhoneNumbersJson,
        includeCallStats: options.includeCallStats || options.includeReferenceIds,
        includeReferenceIds: options.includeReferenceIds,
      };
      const csvContent = generateLeadsCSV(companies, phoneMap, callStatsMap, effectiveOptions);
      const today = new Date().toISOString().slice(0, 10);
      downloadCSV(csvContent, `leads-export-${today}.csv`);

      setStage('done');
      setTimeout(handleClose, 1200);
    } catch (err: unknown) {
      console.error('Export failed:', err);
      setErrorMessage(err instanceof Error ? err.message : 'Export failed. Please try again.');
      setStage('error');
    }
  };

  const toggleOption = (key: keyof ExportOptions) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const estimatedCount = scope === 'filtered' && searchFilter ? `~${companiesCount}` : String(companiesCount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--background)] border border-[var(--card-border)] rounded-xl shadow-2xl w-full max-w-md mx-4">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--card-border)]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--primary-subtle)]">
              <Download size={18} className="text-[var(--primary)]" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Export Companies</h2>
              <p className="text-xs text-[var(--muted)]">Download as CSV file</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-[var(--card-hover)] text-[var(--muted)] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {stage === 'config' && (
            <div className="space-y-5">
              {/* Scope */}
              <div>
                <p className="text-sm font-medium mb-2">Export scope</p>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="scope"
                      value="all"
                      checked={scope === 'all'}
                      onChange={() => setScope('all')}
                      className="accent-[var(--primary)]"
                    />
                    <span className="text-sm">
                      All companies
                      <span className="text-[var(--muted)] ml-1">({companiesCount} total)</span>
                    </span>
                  </label>
                  {searchFilter && (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="scope"
                        value="filtered"
                        checked={scope === 'filtered'}
                        onChange={() => setScope('filtered')}
                        className="accent-[var(--primary)]"
                      />
                      <span className="text-sm">
                        Current filter only
                        <span className="text-[var(--muted)] ml-1">
                          (&ldquo;{searchFilter}&rdquo;)
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              </div>

              {/* Related data options */}
              <div>
                <p className="text-sm font-medium mb-2">Include in export</p>
                <div className="space-y-2">
                  <label className="flex items-start gap-3 cursor-pointer rounded-lg p-2.5 hover:bg-[var(--card-hover)] transition-colors">
                    <input
                      type="checkbox"
                      checked={options.includePhoneNumbersJson}
                      onChange={() => toggleOption('includePhoneNumbersJson')}
                      className="mt-0.5 accent-[var(--primary)]"
                    />
                    <div>
                      <p className="text-sm font-medium">Phone numbers detail</p>
                      <p className="text-xs text-[var(--muted)]">Full phone records with labels, locations, receptionist names (JSON in cell)</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer rounded-lg p-2.5 hover:bg-[var(--card-hover)] transition-colors">
                    <input
                      type="checkbox"
                      checked={options.includeCallStats}
                      onChange={() => toggleOption('includeCallStats')}
                      className="mt-0.5 accent-[var(--primary)]"
                    />
                    <div>
                      <p className="text-sm font-medium">Call activity stats</p>
                      <p className="text-xs text-[var(--muted)]">Total calls, pickups, appointments, last call date & outcome</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-3 cursor-pointer rounded-lg p-2.5 hover:bg-[var(--card-hover)] transition-colors">
                    <input
                      type="checkbox"
                      checked={options.includeReferenceIds}
                      onChange={() => toggleOption('includeReferenceIds')}
                      className="mt-0.5 accent-[var(--primary)]"
                    />
                    <div>
                      <p className="text-sm font-medium">Reference IDs</p>
                      <p className="text-xs text-[var(--muted)]">Session IDs, recording IDs, follow-up IDs (for cross-referencing)</p>
                    </div>
                  </label>
                </div>
              </div>

              {(options.includeCallStats || options.includeReferenceIds) && companiesCount > 100 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--warning-subtle)] text-[var(--warning)] text-xs">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>Fetching call stats for {estimatedCount} companies may take 30–60 seconds.</span>
                </div>
              )}
            </div>
          )}

          {stage === 'fetching' && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <Loader2 size={32} className="animate-spin text-[var(--primary)]" />
              <div className="text-center">
                <p className="text-sm font-medium">Preparing export...</p>
                <p className="text-xs text-[var(--muted)] mt-1">{fetchProgress}</p>
              </div>
            </div>
          )}

          {stage === 'done' && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <CheckCircle size={32} className="text-[var(--success)]" />
              <p className="text-sm font-medium">CSV downloaded successfully</p>
            </div>
          )}

          {stage === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--error-subtle)]">
                <AlertCircle size={18} className="text-[var(--error)] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-[var(--error)]">Export failed</p>
                  <p className="text-xs text-[var(--muted)] mt-1">{errorMessage}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {(stage === 'config' || stage === 'error') && (
          <div className="flex items-center justify-end gap-2 px-5 pb-5">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={stage === 'error' ? () => setStage('config') : handleExport}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--foreground)] text-[var(--background)] hover:opacity-90 transition-colors flex items-center gap-2"
            >
              <Download size={14} />
              {stage === 'error' ? 'Try Again' : `Export ${estimatedCount} Companies`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
