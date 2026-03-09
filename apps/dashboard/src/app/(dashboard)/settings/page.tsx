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
import { useUserPreferences } from '@/hooks/use-user-preferences';

function SettingsContent() {
  const { addToast } = useToast();
  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');
  const { preferences, isLoading, isSaving, updatePreferences } = useUserPreferences();

  const handleUpdatePreferences = async (updates: Partial<UserPreferences>) => {
    try {
      await updatePreferences(updates);
      addToast('success', 'Settings saved');
    } catch (error) {
      addToast('error', 'Failed to save settings');
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
      updatePreferences: handleUpdatePreferences,
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
