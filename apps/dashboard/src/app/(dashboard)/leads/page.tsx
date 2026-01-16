"use client";

import { useState, useEffect } from 'react';
import { pb } from '@/lib/pocketbase';
import { Lead, Company, COLLECTIONS } from '@/lib/types';
import { format } from 'date-fns';

interface UnifiedLead extends Lead {
  isCompany?: boolean;
  companyId?: string;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<UnifiedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const [selectedLead, setSelectedLead] = useState<UnifiedLead | null>(null);

  useEffect(() => {
    fetchLeads();
  }, []);

  // ... fetchLeads ...

  return (
    <div className="p-6">
      {/* ... header ... */}
      
      {/* ... table ... */}
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button 
                      onClick={() => setSelectedLead(lead)}
                      className="text-blue-600 hover:text-blue-900 mr-4"
                    >
                      View
                    </button>
                    <button className="text-gray-600 hover:text-gray-900">Edit</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedLead && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold">{selectedLead.username}</h2>
              <button onClick={() => setSelectedLead(null)} className="text-gray-500 hover:text-gray-700">
                ✕
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <p className="font-medium">{selectedLead.status}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Source</p>
                <p className="font-medium">{selectedLead.source}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Email</p>
                <p className="font-medium">{selectedLead.email || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Phone</p>
                <p className="font-medium">{selectedLead.phone || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">First Contacted</p>
                <p className="font-medium">{selectedLead.first_contacted ? format(new Date(selectedLead.first_contacted), 'PP p') : '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Last Updated</p>
                <p className="font-medium">{selectedLead.last_updated ? format(new Date(selectedLead.last_updated), 'PP p') : '-'}</p>
              </div>
            </div>

            {selectedLead.notes && (
              <div className="mb-6">
                <p className="text-sm text-gray-500 mb-1">Notes</p>
                <div className="bg-gray-50 p-3 rounded text-sm">{selectedLead.notes}</div>
              </div>
            )}
            
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setSelectedLead(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Close</button>
              <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Edit Details</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}