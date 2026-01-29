'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { pb } from '@/lib/pocketbase';
import { UserPreferences, COLLECTIONS } from '@/lib/types';

const DEFAULT_PREFERENCES: Partial<UserPreferences> = {
  theme: 'system',
  display_density: 'comfortable',
  timezones: [
    { timezone: 'America/New_York', label: 'EST' },
    { timezone: 'America/Los_Angeles', label: 'PST' },
    { timezone: 'UTC', label: 'UTC' },
  ],
  notification_settings: {
    follow_up_reminders: true,
    team_activity: true,
    new_recordings: true,
    system_announcements: true,
    daily_digest: false,
    weekly_summary: false,
    new_team_member: true,
    important_updates: true,
    sound_enabled: true,
    dnd_enabled: false,
  },
  workflow_preferences: {
    default_page_size: 25,
    default_sort_order: 'newest',
    remember_columns: true,
    default_follow_up_interval: '3_days',
    auto_follow_up_callback: true,
    auto_start_recording: false,
    show_transcript_panel: true,
    expanded_view: false,
  },
  privacy_settings: {
    show_online_status: true,
    activity_visibility: 'team',
  },
};

export function useUserPreferences() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadFromLocalStorage = useCallback((): UserPreferences => {
    const stored = localStorage.getItem('user_preferences');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Sync timezones separately if they exist in sidebar_timezones
        const sidebarTimezones = localStorage.getItem('sidebar_timezones');
        if (sidebarTimezones) {
          parsed.timezones = JSON.parse(sidebarTimezones);
        }
        return { ...DEFAULT_PREFERENCES, ...parsed, id: 'local' } as UserPreferences;
      } catch {
        // Fall back to default
      }
    }
    return { ...DEFAULT_PREFERENCES, id: 'local' } as UserPreferences;
  }, []);

  const fetchPreferences = useCallback(async () => {
    if (!user?.id) {
      setPreferences(loadFromLocalStorage());
      setIsLoading(false);
      return;
    }

    try {
      const records = await pb.collection(COLLECTIONS.USER_PREFERENCES).getList<UserPreferences>(1, 1, {
        filter: `user = "${user.id}"`,
      });

      if (records.items.length > 0) {
        setPreferences(records.items[0]);
        // Update localStorage as cache
        localStorage.setItem('user_preferences', JSON.stringify(records.items[0]));
        localStorage.setItem('sidebar_timezones', JSON.stringify(records.items[0].timezones || []));
      } else {
        const newPrefs = await pb.collection(COLLECTIONS.USER_PREFERENCES).create<UserPreferences>({
          user: user.id,
          ...DEFAULT_PREFERENCES,
        });
        setPreferences(newPrefs);
        localStorage.setItem('user_preferences', JSON.stringify(newPrefs));
        localStorage.setItem('sidebar_timezones', JSON.stringify(newPrefs.timezones || []));
      }
    } catch (error) {
      console.warn('PocketBase preferences unavailable, using localStorage');
      setPreferences(loadFromLocalStorage());
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, loadFromLocalStorage]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const updatePreferences = async (updates: Partial<UserPreferences>) => {
    const currentPrefs = preferences || loadFromLocalStorage();
    
    setIsSaving(true);
    try {
      if (!user?.id || currentPrefs.id === 'local') {
        const updated = { ...currentPrefs, ...updates };
        localStorage.setItem('user_preferences', JSON.stringify(updated));
        if (updates.timezones) {
          localStorage.setItem('sidebar_timezones', JSON.stringify(updates.timezones));
        }
        setPreferences(updated);
      } else {
        const updated = await pb.collection(COLLECTIONS.USER_PREFERENCES).update<UserPreferences>(
          currentPrefs.id,
          updates
        );
        setPreferences(updated);
        localStorage.setItem('user_preferences', JSON.stringify(updated));
        if (updates.timezones) {
          localStorage.setItem('sidebar_timezones', JSON.stringify(updates.timezones));
        }
      }
    } catch (error) {
      console.error('Failed to update preferences:', error);
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  return {
    preferences,
    isLoading,
    isSaving,
    updatePreferences,
    refresh: fetchPreferences
  };
}
