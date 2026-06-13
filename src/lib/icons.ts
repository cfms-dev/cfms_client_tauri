// CFMS Client — Centralized Material Symbols icon registry
//
// Every semantic icon used in the application maps to its material-symbols
// name here.  This file is the single source of truth — components should
// never hard-code icon names.
//
// These names match the Google Material Symbols font (same as
// flet_material_symbols used in the reference Flet project).

export const ICONS = {
  // ---- Navigation / Tabs ----
  connect:       'settings_ethernet',
  home:          'home',
  files:         'folder',
  tasks:         'arrow_circle_down',
  more:          'more_horiz',
  manage:        'cloud_circle',

  // ---- Auth ----
  login:         'login',
  logout:        'logout',
  chevronLeft:   'chevron_left',
  password:      'password',
  accountCircle: 'account_circle',
  pin:           'pin',
  fingerprint:   'fingerprint',

  // ---- Actions ----
  delete:        'delete',
  cancel:        'cancel',
  pause:         'pause',
  resume:        'play_arrow',
  refresh:       'refresh',
  download:      'download',
  upload:        'upload',
  openInNew:     'open_in_new',
  search:        'search',
  settings:      'settings',
  info:          'info',
  arrowBack:     'arrow_back',
  bugReport:     'bug_report',
  update:        'update',
  close:         'close',
  done:          'done',
  add:           'add',
  remove:        'remove',
  code:          'code',
  rule:          'rule',
  menu:          'menu',
  moreVert:      'more_vert',
  check:         'check',
  checkBox:      'check_box',
  checkBoxBlank: 'check_box_outline_blank',
  radioChecked:  'radio_button_checked',
  radioUnchecked:'radio_button_unchecked',
  playlistRemove:'playlist_remove',

  // ---- Download status ----
  checkCircle:   'check_circle',
  errorFilled:   'error',
  schedule:      'schedule',
  pauseCircle:   'pause_circle',
  lockOpen:      'lock_open',
  verified:      'verified',
  accessTime:    'access_time',
  downloadDone:  'download_done',
  help:          'help',

  // ---- File operations ----
  folder:           'folder',
  folderOpen:       'folder_open',
  createNewFolder:  'create_new_folder',
  filePresent:      'description',
  driveFileMove:    'drive_file_move',
  star:             'star',
  starOutline:      'star_outline',
  deleteForever:    'delete_forever',
  restoreFromTrash: 'restore_from_trash',
  clearAll:         'clear_all',
  deleteSweep:      'delete_sweep',
  filterList:       'filter_list',
  selectAll:        'select_all',
  checklist:        'checklist',
  folderUpload:     'drive_folder_upload',
  folderEye:        'folder_eye',
  arrowUpward:      'arrow_upward',
  arrowDownward:    'arrow_downward',
  sortByAlpha:      'sort_by_alpha',
  sort:             'sort',
  swapVert:         'swap_vert',
  lock:             'lock',
  lockPerson:       'lock_person',
  history:          'history',
  listAlt:          'list_alt',
  uploadFile:       'upload_file',

  // ---- Home / More ----
  guardian:     'guardian',

  // ---- Lockdown / Warnings ----
  emergencyHome: 'emergency_home',
  warning:       'warning',

  // ---- Management ----
  supervisorAccount:    'supervisor_account',
  adminPanelSettings:   'admin_panel_settings',
  article:              'article',
  groups:               'groups',
  groupAdd:             'group_add',
  manageAccounts:       'manage_accounts',
  block:                'block',
  visibility:           'visibility',
  edit:                 'edit',
  calendarToday:        'calendar_today',
  navigateBefore:       'navigate_before',
  navigateNext:         'navigate_next',
  formatListBulleted:   'format_list_bulleted',
  groupRemove:          'group_remove',

  // ---- Settings sub-pages ----
  language:       'translate',
  storage:        'storage',
  security:       'security',
  verifiedUser:   'verified_user',
  approvalDelegation: 'approval_delegation',
  qrCode:         'qr_code_2',
  browserUpdated: 'browser_updated',
  touchApp:       'touch_app',

  // ---- Misc UI ----
  sidebarToggle:  'menu',
  breadcrumbSep:  'chevron_right',
  expandMore:     'expand_more',
  expandLess:     'expand_less',
  warningAmber:   'warning_amber',
  supervisedUserCircleOff: 'supervised_user_circle_off',
  ifl:            'ifl',
} as const;

export type IconName = keyof typeof ICONS;
