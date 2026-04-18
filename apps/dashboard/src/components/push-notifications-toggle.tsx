'use client';

import { usePushSubscription } from '@/hooks/use-push-subscription';
import { ToggleSwitch } from '@/components/ui/toggle-switch';

export function PushNotificationsToggle() {
  const { status, busy, error, enable, disable } = usePushSubscription();

  const subscribed = status === 'subscribed';
  const disabled = busy
    || status === 'unsupported'
    || status === 'unconfigured'
    || status === 'denied';

  const description = (() => {
    if (status === 'unsupported') return 'This browser does not support push notifications.';
    if (status === 'unconfigured') return 'Push service is not configured on this deployment.';
    if (status === 'denied') return 'Notifications blocked — enable them in your browser site settings.';
    if (error) return `Error: ${error}`;
    if (subscribed) return 'Follow-up reminders will be pushed to this device even when the tab is closed.';
    return 'Receive follow-up reminders on this device (requires installing the app on mobile).';
  })();

  return (
    <ToggleSwitch
      checked={subscribed}
      onChange={(v) => { void (v ? enable() : disable()); }}
      label="Push notifications on this device"
      description={description}
      disabled={disabled}
    />
  );
}
