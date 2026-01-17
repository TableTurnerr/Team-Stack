"use client";

import { useState, useEffect } from 'react';
import { pb } from '@/lib/pocketbase';
import { Lead, COLLECTIONS } from '@/lib/types';
import { format } from 'date-fns';
import { Search, Users, X, Eye, Edit3, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/auth-context';

interface UnifiedLead extends Lead {
  isCompany?: boolean;
  companyId?: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  'Warm': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Booked': { bg: 'bg-[var(--success-subtle)]', text: 'text-[var(--success)]' },
  'Replied': { bg: 'bg-[var(--info-subtle)]', text: 'text-[var(--info)]' },
  'Cold': { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' },
  'Not Interested': { bg: 'bg-[var(--error-subtle)]', text: 'text-[var(--error)]' },
};

export default function LeadsPage() {
  const { isAuthenticated } = useAuth();
  const [leads, setLeads] = useState<UnifiedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [selectedLead, setSelectedLead] = useState<UnifiedLead | null>(null);

  useEffect(() => {
    if (isAuthenticated) fetchLeads();
  }, [isAuthenticated]);

  async function fetchLeads() {
    try {
      setLoading(true);
      const records = await pb.collection(COLLECTIONS.LEADS).getFullList<Lead>({
        sort: '-created',
      });
      setLeads(records);
    } catch (error) {
      console.error("Error fetching leads:", error);
    } finally {
      setLoading(false);
    }
  }

  const filteredLeads = leads.filter(lead =>
    lead.username?.toLowerCase().includes(filter.toLowerCase()) ||
    lead.email?.toLowerCase().includes(filter.toLowerCase())
  );

  const getStatusStyle = (status: string) => {
    return STATUS_STYLES[status] || { bg: 'bg-[var(--card-hover)]', text: 'text-[var(--muted)]' };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-[var(--muted)] mt-1">Manage your prospects and leads</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              type="text"
              placeholder="Search leads..."
              className="pl-9 pr-4 py-2 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] w-64"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <button
            onClick={fetchLeads}
            className="p-2 rounded-lg border border-[var(--card-border)] hover:bg-[var(--card-hover)] transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-16 text-center">
            <RefreshCw size={32} className="mx-auto mb-4 text-[var(--muted)] animate-spin" />
            <p className="text-sm text-[var(--muted)]">Loading leads...</p>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="p-16 text-center">
            <div className="w-12 h-12 rounded-full bg-[var(--card-hover)] flex items-center justify-center mx-auto mb-4">
              <Users size={24} className="text-[var(--muted)]" />
            </div>
            <p className="text-sm font-medium">No leads found</p>
            <p className="text-xs text-[var(--muted)] mt-1">
              {filter ? 'Try adjusting your search' : 'Add some leads to get started'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[var(--table-header)] border-b border-[var(--table-border)]">
                <tr>
                  <th className="text-left py-3 px-5 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Name</th>
                  <th className="text-left py-3 px-5 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Status</th>
                  <th className="text-left py-3 px-5 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Source</th>
                  <th className="text-left py-3 px-5 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Contact</th>
                  <th className="text-right py-3 px-5 text-xs font-medium text-[var(--muted)] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--table-border)]">
                {filteredLeads.map((lead) => {
                  const statusStyle = getStatusStyle(lead.status || 'Cold');
                  return (
                    <tr key={lead.id} className="hover:bg-[var(--table-row-hover)] transition-colors">
                      <td className="py-3.5 px-5">
                        <div>
                          <p className="text-sm font-medium">{lead.username}</p>
                          <p className="text-xs text-[var(--muted)]">{lead.email || '-'}</p>
                        </div>
                      </td>
                      <td className="py-3.5 px-5">
                        <span className={cn(
                          'px-2 py-1 rounded text-xs font-medium',
                          statusStyle.bg,
                          statusStyle.text
                        )}>
                          {lead.status || 'Unknown'}
                        </span>
                      </td>
                      <td className="py-3.5 px-5">
                        <span className="text-sm text-[var(--muted)]">{lead.source || '-'}</span>
                      </td>
                      <td className="py-3.5 px-5">
                        <span className="text-sm font-mono text-[var(--muted)]">{lead.phone || '-'}</span>
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setSelectedLead(lead)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-white text-[var(--background)] border border-[var(--card-border)] hover:bg-gray-100 transition-colors"
                          >
                            <Eye size={14} />
                            View
                          </button>
                          <button className="p-1.5 rounded-md text-[var(--muted)] hover:bg-[var(--card-hover)] hover:text-[var(--foreground)] transition-colors">
                            <Edit3 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lead Detail Modal */}
      {selectedLead && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl max-w-2xl w-full shadow-2xl max-h-[90vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border)]">
              <div>
                <h2 className="text-lg font-semibold">{selectedLead.username}</h2>
                <span className={cn(
                  'inline-flex px-2 py-0.5 rounded text-xs font-medium mt-1',
                  getStatusStyle(selectedLead.status || 'Cold').bg,
                  getStatusStyle(selectedLead.status || 'Cold').text
                )}>
                  {selectedLead.status || 'Unknown'}
                </span>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="p-2 rounded-lg hover:bg-[var(--card-hover)] transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-5 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">Status</p>
                  <p className="text-sm font-medium">{selectedLead.status || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">Source</p>
                  <p className="text-sm font-medium">{selectedLead.source || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">Email</p>
                  <p className="text-sm font-medium">{selectedLead.email || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">Phone</p>
                  <p className="text-sm font-medium font-mono">{selectedLead.phone || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">First Contacted</p>
                  <p className="text-sm font-medium">
                    {selectedLead.first_contacted ? format(new Date(selectedLead.first_contacted), 'PPP p') : '-'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-1">Last Updated</p>
                  <p className="text-sm font-medium">
                    {selectedLead.last_updated ? format(new Date(selectedLead.last_updated), 'PPP p') : '-'}
                  </p>
                </div>
              </div>

              {selectedLead.notes && (
                <div className="mt-6">
                  <p className="text-xs text-[var(--muted)] uppercase tracking-wider mb-2">Notes</p>
                  <div className="bg-[var(--card-hover)] rounded-lg p-4 text-sm">
                    {selectedLead.notes}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--card-border)]">
              <button
                onClick={() => setSelectedLead(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium hover:bg-[var(--card-hover)] transition-colors"
              >
                Close
              </button>
              <button className="px-4 py-2 rounded-lg text-sm font-medium bg-white text-[var(--background)] border border-[var(--card-border)] hover:bg-gray-100 transition-colors">
                Edit Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
