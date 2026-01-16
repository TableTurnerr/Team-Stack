"use client";

import { useState, useEffect } from 'react';
import { pb } from '@/lib/pocketbase';
import { InstaActor, COLLECTIONS, User } from '@/lib/types';
import { format, subDays } from 'date-fns';
import { Instagram, Activity, User as UserIcon } from 'lucide-react';

interface ActorStats {
  dmsSent: number;
}

interface ActorWithStats extends InstaActor {
  stats: ActorStats;
  ownerName?: string;
}

export default function ActorsPage() {
  const [actors, setActors] = useState<ActorWithStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActors();
  }, []);

  async function fetchActors() {
    setLoading(true);
    try {
      const result = await pb.collection(COLLECTIONS.INSTA_ACTORS).getList<InstaActor>(1, 100, { 
        sort: '-last_activity',
        expand: 'owner' 
      });

      const actorsData = await Promise.all(result.items.map(async (actor) => {
        // Count DMs (Total)
        let dmsSent = 0;
        try {
            const dmsResult = await pb.collection(COLLECTIONS.EVENT_LOGS).getList(1, 1, {
                filter: `actor = "${actor.id}" && event_type = "Outreach"`,
                fields: 'id'
            });
            dmsSent = dmsResult.totalItems;
        } catch (e) { console.error(e); }

        const owner = actor.expand?.owner as User | undefined;

        return {
          ...actor,
          ownerName: owner?.name || 'Unassigned',
          stats: { dmsSent }
        };
      }));

      setActors(actorsData);
    } catch (error) {
      console.error("Error fetching actors:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Instagram Actors</h1>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Account</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Owner</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Activity</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Active</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-4 text-center">Loading...</td></tr>
            ) : actors.map((actor) => (
              <tr key={actor.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10 bg-pink-100 rounded-full flex items-center justify-center text-pink-600">
                      <Instagram size={20} />
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">@{actor.username}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full
                    ${actor.status === 'Active' ? 'bg-green-100 text-green-800' : 
                      actor.status.includes('Suspended') ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                    {actor.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div className="flex items-center gap-1">
                    <UserIcon size={14} />
                    {actor.ownerName}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div className="flex items-center gap-1">
                     <Activity size={14} />
                     {actor.stats.dmsSent} DMs sent
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {actor.last_activity ? format(new Date(actor.last_activity), 'MMM d, HH:mm') : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}