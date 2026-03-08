import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { isSupabaseAdminConfigured } from '@/lib/server/env';
import { SMS_NOTIFICATIONS_COMING_SOON } from '@/lib/notifications/smsAvailability';

export async function loadSmsSystemEnabled(): Promise<boolean> {
  if (SMS_NOTIFICATIONS_COMING_SOON) return false;
  if (!isSupabaseAdminConfigured()) return true;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('system_settings').select('key,value').eq('key', 'sms_enabled').maybeSingle();
  if (error) return true;
  return readBooleanSetting(data?.value, true);
}

function readBooleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase();
    if (cleaned === 'true') return true;
    if (cleaned === 'false') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}
