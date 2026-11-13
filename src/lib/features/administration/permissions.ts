/** Shared by navigation and the management workspace. */
export const administrationPermissions = [
  'view_audit_logs', 'list_users', 'list_groups', 'create_user', 'create_group',
  'delete_user', 'delete_group', 'super_configure_auth_methods', 'super_list_user_auth_methods',
  'list_banned_subnets', 'manage_banned_subnets', 'list_auth_lockouts', 'unlock_auth_lockouts',
  'view_settings', 'manage_settings', 'super_set_username', 'super_set_nickname',
] as const;
export function canAccessAdministration(permissions: readonly string[]): boolean {
  return administrationPermissions.some((permission) => permissions.includes(permission));
}
