export function resolveAdminAccessOverrideErrorMessage(code: string | null, fallback: string) {
  if (code === 'admin_access_override_not_configured') {
    return 'Admin access testing is not configured on this backend yet. Apply the admin access override migration before using this control.';
  }

  if (code === 'supabase_admin_not_configured') {
    return 'Admin access testing is unavailable because this backend is missing admin Supabase configuration.';
  }

  if (code === 'forbidden') {
    return 'Admin access testing is only available to signed-in admins.';
  }

  return fallback;
}
