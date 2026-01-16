"use client";

import { useState, useEffect } from 'react';
import { pb } from '@/lib/pocketbase';
import { User, COLLECTIONS } from '@/lib/types';
import { Plus, Phone, MessageSquare, Clock } from 'lucide-react';
import { format } from 'date-fns';

interface UserStats {
  calls: number;
  dms: number;
}

interface UserWithStats extends User {
  stats: UserStats;
}

export default function TeamPage() {
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsersAndStats();
  }, []);

  async function fetchUsersAndStats() {
    setLoading(true);
    try {
      const usersResult = await pb.collection(COLLECTIONS.USERS).getList<User>(1, 50, { sort: 'name' });
      
      // Calculate stats for each user
      // Note: In a real app with much data, this should be an aggregation query or backend endpoint.
      // Here we fetch recent logs or just counts if possible. 
      // PB doesn't have "count" API for groups easily. 
      // We will do a hacky generic fetch for stats or just 0 for now to keep it fast/safe.
      // Or we can try to fetch counts with filter per user.
      
      const usersWithStats = await Promise.all(usersResult.items.map(async (user) => {
        // Count calls
        // Assuming claimed_by or caller_name matches user. 
        // We'll use claimed_by ID.
        let calls = 0;
        try {
           const callsResult = await pb.collection(COLLECTIONS.COLD_CALLS).getList(1, 1, {
             filter: `claimed_by = "${user.id}"`,
             fields: 'id'
           });
           calls = callsResult.totalItems;
        } catch (e) { console.error(e); }

        // Count DMs (Outreach events initiated by user)
        let dms = 0;
        try {
            const dmsResult = await pb.collection(COLLECTIONS.EVENT_LOGS).getList(1, 1, {
                filter: `user = "${user.id}" && event_type = "Outreach"`,
                fields: 'id'
            });
            dms = dmsResult.totalItems;
        } catch (e) { console.error(e); }

        return {
          ...user,
          stats: { calls, dms }
        };
      }));

      setUsers(usersWithStats);
    } catch (error) {
      console.error("Error fetching team:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddMember() {
    const email = prompt("Enter email for new member:");
    if (!email) return;
    const password = prompt("Enter temporary password:");
    if (!password) return;
    const name = prompt("Enter name:");
    
    try {
        await pb.collection(COLLECTIONS.USERS).create({
            email,
            password,
            passwordConfirm: password,
            name,
            role: 'member',
            status: 'offline'
        });
        alert("User created!");
        fetchUsersAndStats();
    } catch (e) {
        alert("Failed to create user: " + e);
    }
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Team Members</h1>
        <button 
          onClick={handleAddMember}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus size={20} />
          Add Member
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {users.map((user) => (
          <div key={user.id} className="bg-white rounded-lg shadow p-6 border border-gray-100">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{user.name}</h3>
                <p className="text-sm text-gray-500">{user.email}</p>
              </div>
              <span className={`px-2 py-1 text-xs font-semibold rounded-full 
                ${user.status === 'online' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                {user.status}
              </span>
            </div>
            
            <div className="text-sm text-gray-500 mb-6">
               <span className="capitalize">{user.role}</span>
            </div>

            <div className="grid grid-cols-2 gap-4 border-t pt-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-gray-500 mb-1">
                  <Phone size={14} />
                  <span className="text-xs uppercase">Calls</span>
                </div>
                <div className="text-xl font-bold text-gray-900">{user.stats.calls}</div>
              </div>
              <div className="text-center border-l">
                <div className="flex items-center justify-center gap-1 text-gray-500 mb-1">
                  <MessageSquare size={14} />
                  <span className="text-xs uppercase">DMs Sent</span>
                </div>
                <div className="text-xl font-bold text-gray-900">{user.stats.dms}</div>
              </div>
            </div>
            
            <div className="mt-4 pt-4 border-t flex items-center gap-2 text-xs text-gray-400">
                <Clock size={12} />
                Last active: {user.last_activity ? format(new Date(user.last_activity), 'PP p') : 'Never'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}