'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { pb } from '@/lib/pocketbase';
import { UserPreferences, COLLECTIONS } from '@/lib/types';
import { SettingsNav, SettingsSection } from './components/settings-nav';
import { ProfileSection } from './components/profile-section';
import { AccountSection } from './components/account-section';
import { AppearanceSection } from './components/appearance-section';
import { NotificationsSection } from './components/notifications-section';
import { PreferencesSection } from './components/preferences-section';
import { TeamSection } from './components/team-section';
import { IntegrationsSection } from './components/integrations-section';
import { DataPrivacySection } from './components/data-privacy-section';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { Loader2 } from 'lucide-react';

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

function SettingsContent() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [useLocalStorage, setUseLocalStorage] = useState(false);

  // Load preferences from localStorage as fallback
  const loadFromLocalStorage = useCallback((): UserPreferences => {
    const stored = localStorage.getItem('user_preferences');
    if (stored) {
      try {
        return { ...DEFAULT_PREFERENCES, ...JSON.parse(stored), id: 'local' } as UserPreferences;
      } catch {
        // Invalid JSON, use defaults
      }
    }
    return { ...DEFAULT_PREFERENCES, id: 'local' } as UserPreferences;
  }, []);

  // Fetch or create user preferences
  const fetchPreferences = useCallback(async () => {
    if (!user?.id) return;

    try {
      const records = await pb.collection(COLLECTIONS.USER_PREFERENCES).getList<UserPreferences>(1, 1, {
        filter: `user = "${user.id}"`,
      });

      if (records.items.length > 0) {
        setPreferences(records.items[0]);
      } else {
        // Create default preferences for this user
        const newPrefs = await pb.collection(COLLECTIONS.USER_PREFERENCES).create<UserPreferences>({
          user: user.id,
          ...DEFAULT_PREFERENCES,
        });
        setPreferences(newPrefs);
      }
    } catch (error: any) {
      console.warn('PocketBase preferences unavailable, using localStorage:', error?.message);
      // Fallback to localStorage if collection doesn't exist
      setUseLocalStorage(true);
      setPreferences(loadFromLocalStorage());
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, loadFromLocalStorage]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  // Update preferences in PocketBase or localStorage
  const updatePreferences = async (updates: Partial<UserPreferences>) => {
    if (!preferences) return;

    setIsSaving(true);
    try {
      if (useLocalStorage || !preferences.id || preferences.id === 'local') {
        // Save to localStorage
        const updated = { ...preferences, ...updates };
        localStorage.setItem('user_preferences', JSON.stringify(updated));
        setPreferences(updated);
        addToast('success', 'Settings saved locally');
      } else {
        // Save to PocketBase
        const updated = await pb.collection(COLLECTIONS.USER_PREFERENCES).update<UserPreferences>(
          preferences.id,
          updates
        );
        setPreferences(updated);
        addToast('success', 'Settings saved');
      }
    } catch (error) {
      console.error('Failed to save preferences:', error);
      addToast('error', 'Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--muted)]" />
      </div>
    );
  }

  const renderSection = () => {
    const commonProps = {
      preferences,
      updatePreferences,
      isSaving,
    };

    switch (activeSection) {
      case 'profile':
        return <ProfileSection />;
      case 'account':
        return <AccountSection />;
      case 'appearance':
        return <AppearanceSection {...commonProps} />;
      case 'notifications':
        return <NotificationsSection {...commonProps} />;
      case 'preferences':
        return <PreferencesSection {...commonProps} />;
      case 'team':
        return <TeamSection />;
      case 'integrations':
        return <IntegrationsSection {...commonProps} />;
      case 'data-privacy':
        return <DataPrivacySection {...commonProps} />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-[var(--muted)] mt-1">Manage your account and preferences</p>
      </div>

      {/* Layout */}
      <div className="flex flex-col lg:flex-row gap-6">
        <SettingsNav activeSection={activeSection} onSectionChange={setActiveSection} />

        <div className="flex-1 min-w-0">
          <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-6">
            {renderSection()}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <ToastProvider>
      <SettingsContent />
    </ToastProvider>
  );
}
