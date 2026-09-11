// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
import {Flags} from '@oclif/core'

import {DocuSignBaseCommand} from '../base.js'
import type {AciMetadata, ResponseShape} from '../../../../core/contract/aci.js'
import type {
  DocuSignClient,
  PermissionProfile,
  PermissionProfileSettings,
} from '../client.js'

/**
 * DocuSign returns boolean settings as string-encoded "true"/"false"
 * (plus rare "always_true"/"always_false" for a few fields). Normalize
 * to a single boolean; enum-valued settings (allowedTemplateAccess,
 * webForms, etc.) are handled separately via `settingEnum`.
 */
function settingFlag(settings: PermissionProfileSettings | undefined, key: string): boolean {
  if (!settings) return false
  const v = settings[key]
  if (v === true) return true
  if (v === false) return false
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    return s === 'true' || s === 'always_true'
  }
  return false
}

/**
 * Read an enum-valued setting as a lowercase string; returns empty
 * string if missing. Used for `allowedTemplateAccess`, `webForms`, etc.
 */
function settingEnum(settings: PermissionProfileSettings | undefined, key: string): string {
  if (!settings) return ''
  const v = settings[key]
  return typeof v === 'string' ? v.toLowerCase() : ''
}

interface EntityCrud {
  read: boolean
  create: boolean
  update: boolean
  delete: boolean
}

/**
 * Flatten a permission profile's ~50 boolean settings into the platform's
 * generic entity/CRUD shape. The mapping is Permission-Profile-centric:
 * each entity name captures a conceptual resource the profile grants
 * access to, not a DocuSign API endpoint.
 *
 * This table is the single source of truth for how DocuSign settings
 * project onto entities; the gateway-side normalizer just forwards it.
 */
function flattenProfileSettings(settings: PermissionProfileSettings | undefined): Record<string, EntityCrud> {
  const s = (key: string) => settingFlag(settings, key)
  const e = (key: string) => settingEnum(settings, key)

  // Account-wide admin flag — drives folder / user / account_settings CRUD.
  const admin = s('allowAccountManagement')

  // Envelopes: DocuSign has no distinct delete flag; "delete" in the API
  // is a move-to-recyclebin, which anyone who can send envelopes can do
  // to their own envelopes. Tie delete to send for a useful effective matrix.
  const allowSend = s('allowEnvelopeSending')
  const allowTag = s('allowTaggingInSendAndCorrect')

  // Templates: enum `allowedTemplateAccess` is the modern control
  //   "none" | "use" | "create" | "share" | "manage"
  const tmplAccess = e('allowedTemplateAccess')
  const tmplRead = tmplAccess !== '' && tmplAccess !== 'none'
  const tmplCreate = ['create', 'share', 'manage'].includes(tmplAccess)
  const tmplUpdate = ['share', 'manage'].includes(tmplAccess)
  const tmplDelete = tmplAccess === 'manage'

  // Bulk send is a boolean feature flag.
  const allowBulk = s('allowBulkSending')

  // JWT-grant implies API access regardless of `allowApiAccess` (which is
  // a *user-level* legacy flag and commonly "false" even for admins);
  // `allowApiAccessToAccount` is the modern equivalent.
  const apiAccess = s('allowApiAccess') || s('allowApiAccessToAccount')

  // Connect (outbound webhooks / event publishing). Not a dedicated
  // profile setting — gated by admin access on this account.
  const allowConnect = admin

  // Signing groups have no dedicated profile flag on the demo account;
  // admins can manage them, senders cannot.
  const allowSigningGroups = admin

  return {
    'docusign:envelope': {
      read: true,
      create: allowSend,
      update: allowTag || allowSend,
      delete: allowSend,
    },
    'docusign:template': {
      read: tmplRead,
      create: tmplCreate,
      update: tmplUpdate,
      delete: tmplDelete,
    },
    'docusign:folder': {
      read: true,
      create: admin,
      update: admin,
      delete: admin,
    },
    'docusign:bulk_send': {
      read: allowBulk,
      create: allowBulk,
      update: false,
      delete: false,
    },
    'docusign:signing_group': {
      read: allowSigningGroups,
      create: allowSigningGroups,
      update: allowSigningGroups,
      delete: allowSigningGroups,
    },
    'docusign:user': {
      read: admin,
      create: admin,
      update: admin,
      delete: admin,
    },
    'docusign:account_settings': {
      read: admin,
      create: false,
      update: admin,
      delete: false,
    },
    'docusign:connect': {
      read: allowConnect,
      create: allowConnect,
      update: allowConnect,
      delete: allowConnect,
    },
    'docusign:api_access': {
      read: apiAccess,
      create: false,
      update: false,
      delete: false,
    },
  }
}

const BUILTIN_PROFILE_NAMES = new Set([
  'ds admin',
  'ds sender',
  'ds viewer',
  'account administrator',
  'docusign sender',
  'docusign viewer',
])

function isBuiltIn(name: string): boolean {
  return BUILTIN_PROFILE_NAMES.has(name.trim().toLowerCase())
}

function toMachineName(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * Probe envelope read/create permissions by listing a single envelope.
 * Separate from profile-based introspection because the effective
 * permission a JWT-Grant app has can differ from the impersonated user's
 * profile (scope masking, consent revocation).
 */
async function probeEnvelopeAccess(client: DocuSignClient): Promise<{read: boolean}> {
  const perms = {read: false}
  try {
    const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    await client.listEnvelopes({fromDate, count: 1})
    perms.read = true
  } catch {
    // probe failed — leave read: false
  }
  return perms
}

/**
 * Introspect DocuSign permissions for the authenticated service account.
 * Returns entity-level CRUD flattened from the impersonated user's
 * Permission Profile, plus optional full Permission Profile and Group
 * listings. Parallels `aclif salesforce introspect`.
 *
 * Examples:
 *   aclif docusign introspect --json
 *   aclif docusign introspect --permission-profiles --json
 *   aclif docusign introspect --permission-profiles --groups --json
 */
export default class DocuSignIntrospect extends DocuSignBaseCommand {
  static override description = 'Introspect DocuSign permissions: entity CRUD from the effective Permission Profile, and optional full profile/group listings'

  static override aciMetadata: AciMetadata = {
    mutability: 'read',
    idempotent: true,
    reversible: false,
    blastRadius: 'single_record',
    apiCallsConsumed: 4,
    requiresConfirmation: false,
    prerequisites: [],
  }

  static override responseShape: ResponseShape | null = {
    description: "Effective permissions of the impersonated user: entity CRUD, permission profiles, and groups",
    fields: {
      introspectedAt: {type: "string", description: "ISO timestamp"},
      serviceAccountId: {type: "string", description: "impersonated user id"},
      effectivePermissionProfileId: {type: "string", description: "permission profile in force"},
      systemPermissions: {type: "object", description: "account-level flags"},
      entities: {type: "object", description: "entity name to {read, create, update, delete}"},
      permissionProfiles: {type: "array", description: "present with --permission-profiles: [{id, name, label, isBuiltIn, userCount, entityPermissions}]"},
      groups: {type: "array", description: "present with --groups: [{id, name, groupType, permissionProfileId, userCount}]"},
    },
    example: {"introspectedAt": "2026-09-11T00:00:00.000Z", "serviceAccountId": "00000000-0000-0000-0000-000000000000", "effectivePermissionProfileId": "1", "systemPermissions": {"canManageAccount": false}, "entities": {"envelopes": {"read": true, "create": true, "update": true, "delete": false}}},
  }

  static override flags = {
    ...DocuSignBaseCommand.baseFlags,
    'permission-profiles': Flags.boolean({
      description: 'Fetch all Permission Profiles with full settings + flattened entity CRUD',
      default: false,
    }),
    'groups': Flags.boolean({
      description: 'Fetch DocuSign Groups and their linked permission profile (implies --permission-profiles)',
      default: false,
    }),
  }

  async run(): Promise<void> {
    if (this.shouldSkipExecution()) return
    const {flags} = await this.parse(DocuSignIntrospect)

    try {
      const client = await this.getConnection()

      // Step 1: Envelope access probe — fast sanity check and read/create baseline.
      const envelopeProbe = await probeEnvelopeAccess(client)

      // Step 2: Resolve the impersonated user → their effective permissionProfileId.
      let serviceAccountId: string | undefined
      let effectivePermissionProfileId: string | undefined
      let effectiveSettings: PermissionProfileSettings | undefined

      try {
        const user = await client.getUser(client.impersonatedUser)
        serviceAccountId = user.email || user.userName
        effectivePermissionProfileId = user.permissionProfileId
      } catch {
        // getUser may 403 for non-admin impersonated users. Fall back to
        // envelope-probe-only output below.
      }

      // Step 3: List profiles (needed either way — the effective profile
      // holds the setting flags we flatten into entity CRUD). Silently
      // degrade to envelope-probe-only if the API returns 403.
      let allProfiles: PermissionProfile[] = []
      try {
        const resp = await client.listPermissionProfiles({includeSettings: true})
        allProfiles = resp.permissionProfiles || []
      } catch {
        // Non-admin accounts can't list profiles — keep going.
      }

      const effectiveProfile = effectivePermissionProfileId
        ? allProfiles.find(p => p.permissionProfileId === effectivePermissionProfileId)
        : undefined
      effectiveSettings = effectiveProfile?.settings

      // Step 4: Flatten effective-profile settings → entity/CRUD map.
      // If no profile was resolvable, fall back to the envelope probe:
      // read is whatever the probe returned, everything else is false.
      const entities: Record<string, EntityCrud> = effectiveSettings
        ? flattenProfileSettings(effectiveSettings)
        : {
            'docusign:envelope': {
              read: envelopeProbe.read,
              create: false,
              update: false,
              delete: false,
            },
          }

      // Step 5: System permissions derived from the effective profile.
      const systemPermissions = {
        accountAdmin: settingFlag(effectiveSettings, 'allowAccountManagement'),
        // JWT-grant implies API access — `allowApiAccess` is the legacy
        // user-level flag and is "false" even for admins on many accounts.
        apiAccess: settingFlag(effectiveSettings, 'allowApiAccess')
          || settingFlag(effectiveSettings, 'allowApiAccessToAccount')
          || true,
        bulkSendAccess: settingFlag(effectiveSettings, 'allowBulkSending'),
      }

      // Step 6: Detailed permission profiles (optional).
      // --groups implies --permission-profiles.
      const fetchProfiles = flags['permission-profiles'] || flags['groups']

      let permissionProfiles: Array<{
        id: string
        name: string
        label: string
        description?: string
        isBuiltIn: boolean
        userCount?: number
        entityPermissions: Record<string, EntityCrud>
      }> | undefined

      if (fetchProfiles) {
        permissionProfiles = allProfiles.map(p => ({
          id: p.permissionProfileId,
          name: toMachineName(p.permissionProfileName),
          label: p.permissionProfileName,
          description: undefined,
          isBuiltIn: isBuiltIn(p.permissionProfileName),
          userCount: p.userCount !== undefined ? Number(p.userCount) : undefined,
          entityPermissions: flattenProfileSettings(p.settings),
        }))
      }

      // Step 7: Groups (optional).
      let groups: Array<{
        id: string
        name: string
        groupType: string
        permissionProfileId?: string
        userCount?: number
      }> | undefined

      if (flags['groups']) {
        try {
          const resp = await client.listGroups()
          groups = (resp.groups || []).map(g => ({
            id: g.groupId,
            name: g.groupName,
            groupType: g.groupType || 'customGroup',
            permissionProfileId: g.permissionProfileId,
            userCount: g.userCount !== undefined ? Number(g.userCount) : undefined,
          }))
        } catch {
          // Group list can 403 for non-admin impersonated users.
        }
      }

      const result: Record<string, unknown> = {
        introspectedAt: new Date().toISOString(),
        serviceAccountId,
        effectivePermissionProfileId,
        systemPermissions,
        entities,
      }

      if (permissionProfiles) result.permissionProfiles = permissionProfiles
      if (groups) result.groups = groups

      await this.outputResult(result, this.buildContext({
        returned: Object.keys(entities).length,
        refinements: [
          'Use --permission-profiles to list all Permission Profiles with their flattened entity CRUD',
          'Use --groups to include DocuSign Groups and their linked permission profile',
        ],
      }))
    } catch (error) {
      this.outputError(this.formatError(error))
    }
  }
}
