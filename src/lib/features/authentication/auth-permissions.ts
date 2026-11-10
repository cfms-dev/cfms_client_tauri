/** Authentication inventory and configuration are independently authorized. */
export function canReadAuthentication(permissions: readonly string[], managed: boolean): boolean {
  return !managed || permissions.includes('super_list_user_auth_methods');
}

export function canConfigureAuthentication(permissions: readonly string[], managed: boolean): boolean {
  return permissions.includes('super_configure_auth_methods')
    || (!managed && permissions.includes('configure_auth_methods'));
}
