import { ATOMIC_OP_TABLE, type AtomicOpMeta, type ObjectType } from 'codemirror-lang-cacl';
import { addDurationRfc3339Utc, createCaclRuleId, type CaclVisualRule } from './cacl-model';

export interface CaclOperationGroup {
  id: 'directory' | 'document' | 'namespace' | 'lifecycle' | 'governance';
  labelKey: string;
  ops: AtomicOpMeta[];
}

const OP_GROUP_NAMES: Record<CaclOperationGroup['id'], readonly string[]> = {
  directory: ['TRAVERSE', 'LIST_DIRECTORY', 'CREATE_DOCUMENT', 'CREATE_DIRECTORY'],
  document: ['READ_CONTENT', 'WRITE_CONTENT', 'LIST_REVISIONS', 'READ_REVISION', 'SET_CURRENT_REVISION', 'DELETE_REVISION'],
  namespace: ['READ_METADATA', 'WRITE_METADATA', 'RENAME', 'REPARENT'],
  lifecycle: ['DELETE', 'DIRECTORY_DELETE_CHILD', 'LIST_DELETED', 'RESTORE', 'PURGE'],
  governance: ['READ_DACL', 'WRITE_DACL'],
};

const GROUP_LABEL_KEYS: Record<CaclOperationGroup['id'], string> = {
  directory: 'files.cacl.opGroup.directory',
  document: 'files.cacl.opGroup.document',
  namespace: 'files.cacl.opGroup.namespace',
  lifecycle: 'files.cacl.opGroup.lifecycle',
  governance: 'files.cacl.opGroup.governance',
};

const OP_BY_NAME = new Map(ATOMIC_OP_TABLE.map((op) => [op.name, op]));

export const CACL_OPERATION_GROUPS: readonly CaclOperationGroup[] = (
  Object.keys(OP_GROUP_NAMES) as Array<CaclOperationGroup['id']>
).map((id) => ({
  id,
  labelKey: GROUP_LABEL_KEYS[id],
  ops: OP_GROUP_NAMES[id]
    .map((name) => OP_BY_NAME.get(name))
    .filter((op): op is AtomicOpMeta => op !== undefined),
}));

export const CACL_PRESET_MACRO_ORDER = [
  'PRESET_READ',
  'PRESET_WRITE',
  'PRESET_RW',
  'CREATE_CHILD',
  'MOVE',
  'PRESET_TRASH_RW',
  'PRESET_ACL_RW',
] as const;

export interface CaclRuleTemplate {
  id: string;
  labelKey: string;
  descriptionKey: string;
  buildRule: (targetObjectType?: ObjectType | null) => CaclVisualRule;
  snippet: (targetObjectType?: ObjectType | null) => string;
}

export const CACL_RULE_TEMPLATES: readonly CaclRuleTemplate[] = [
  {
    id: 'read_all',
    labelKey: 'files.cacl.template.readAll',
    descriptionKey: 'files.cacl.template.readAllDesc',
    buildRule: (targetObjectType) => ({
      id: createCaclRuleId(),
      effect: 'allow',
      opItems: [
        {
          name: targetObjectType === 'document' ? 'READ_CONTENT' : 'PRESET_READ',
          subtract: false,
        },
        ...(targetObjectType === 'document'
          ? [{ name: 'READ_METADATA', subtract: false }]
          : []),
      ],
      scope: targetObjectType === 'document' ? 'self' : 'all',
      match: { kind: 'any' },
      validFrom: null,
      validUntil: null,
      remark: null,
    }),
    snippet: (targetObjectType) =>
      targetObjectType === 'document'
        ? 'allow [READ_CONTENT, READ_METADATA] on self to any;'
        : 'allow [PRESET_READ] to any;',
  },
  {
    id: 'group_rw',
    labelKey: 'files.cacl.template.groupRw',
    descriptionKey: 'files.cacl.template.groupRwDesc',
    buildRule: (targetObjectType) => ({
      id: createCaclRuleId(),
      effect: 'allow',
      opItems: [{ name: 'PRESET_RW', subtract: false }],
      scope: targetObjectType === 'document' ? 'self' : 'all',
      match: { kind: 'to', principals: [{ kind: 'group', value: 'editors' }] },
      validFrom: null,
      validUntil: null,
      remark: null,
    }),
    snippet: (targetObjectType) =>
      targetObjectType === 'document'
        ? 'allow [PRESET_RW] on self to group("editors");'
        : 'allow [PRESET_RW] to group("editors");',
  },
  {
    id: 'temp_user_rw',
    labelKey: 'files.cacl.template.tempUserRw',
    descriptionKey: 'files.cacl.template.tempUserRwDesc',
    buildRule: (targetObjectType) => ({
      id: createCaclRuleId(),
      effect: 'allow',
      opItems: [
        { name: 'PRESET_RW', subtract: false },
        { name: 'DELETE', subtract: true },
      ],
      scope: targetObjectType === 'document' ? 'self' : 'all',
      match: { kind: 'to', principals: [] },
      validFrom: addDurationRfc3339Utc(null, 0),
      validUntil: addDurationRfc3339Utc(null, 86_400),
      remark: 'Temporary 24h access',
    }),
    snippet: () => {
      const from = addDurationRfc3339Utc(null, 0);
      const until = addDurationRfc3339Utc(null, 86_400);
      return `allow [PRESET_RW, -DELETE] to user("00000000-0000-4000-8000-000000000000") from "${from}" until "${until}" remark "Temporary 24h access";`;
    },
  },
  {
    id: 'docs_read',
    labelKey: 'files.cacl.template.docsOnly',
    descriptionKey: 'files.cacl.template.docsOnlyDesc',
    buildRule: () => ({
      id: createCaclRuleId(),
      effect: 'allow',
      opItems: [
        { name: 'READ_CONTENT', subtract: false },
        { name: 'READ_METADATA', subtract: false },
      ],
      scope: 'docs',
      match: { kind: 'any' },
      validFrom: null,
      validUntil: null,
      remark: null,
    }),
    snippet: () => 'allow [READ_CONTENT, READ_METADATA] on docs to any;',
  },
  {
    id: 'deny_user',
    labelKey: 'files.cacl.template.denyUser',
    descriptionKey: 'files.cacl.template.denyUserDesc',
    buildRule: () => ({
      id: createCaclRuleId(),
      effect: 'deny',
      opItems: [
        { name: 'PRESET_RW', subtract: false },
        { name: 'PRESET_TRASH_RW', subtract: false },
      ],
      scope: 'all',
      match: { kind: 'to', principals: [] },
      validFrom: null,
      validUntil: null,
      remark: null,
    }),
    snippet: () =>
      'deny [PRESET_RW, PRESET_TRASH_RW] to user("00000000-0000-4000-8000-000000000000");',
  },
  {
    id: 'admin_full',
    labelKey: 'files.cacl.template.adminFull',
    descriptionKey: 'files.cacl.template.adminFullDesc',
    buildRule: () => ({
      id: createCaclRuleId(),
      effect: 'allow',
      opItems: [
        { name: 'PRESET_RW', subtract: false },
        { name: 'PRESET_TRASH_RW', subtract: false },
        { name: 'PRESET_ACL_RW', subtract: false },
        { name: 'READ_REVISION', subtract: false },
        { name: 'DELETE_REVISION', subtract: false },
      ],
      scope: 'all',
      match: { kind: 'to', principals: [{ kind: 'group', value: 'sysop' }] },
      validFrom: null,
      validUntil: null,
      remark: 'Administrator full access',
    }),
    snippet: () =>
      'allow [PRESET_RW, PRESET_TRASH_RW, PRESET_ACL_RW, READ_REVISION, DELETE_REVISION] to group("sysop") remark "Administrator full access";',
  },
];
