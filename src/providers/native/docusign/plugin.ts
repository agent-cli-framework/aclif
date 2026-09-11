// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * DocuSign provider plugin: the one file the registry imports.
 */
import {defineProvider} from '../../../core/provider/plugin.js'
import type {ProviderCommandClass} from '../../../core/provider/plugin.js'
import {createClient} from './client.js'
import {docusignCredentials} from './credentials.js'
import {classifyDocuSignError} from './errors.js'
import {docusignMetadata} from './metadata.js'
import {docusignSession} from './session.js'
import DocusignDiscover from './commands/discover.js'
import DocusignEnvelopesCreate from './commands/envelopes/create.js'
import DocusignEnvelopesDelete from './commands/envelopes/delete.js'
import DocusignEnvelopesDownload from './commands/envelopes/download.js'
import DocusignEnvelopesGet from './commands/envelopes/get.js'
import DocusignEnvelopesList from './commands/envelopes/list.js'
import DocusignEnvelopesViewUrl from './commands/envelopes/view-url.js'
import DocusignIntrospect from './commands/introspect.js'

export const docusignPlugin = defineProvider({
  name: 'docusign',
  displayName: 'DocuSign',
  description: 'DocuSign eSignature envelopes',
  metadata: docusignMetadata,
  credentials: docusignCredentials,
  createClient,
  classifyError: classifyDocuSignError,
  session: docusignSession,
  http: (client) => ({request: (r) => client.rawRequest(r.method, r.path, r.query, r.body)}),
  healthProbe: ['docusign', 'envelopes', 'list'],
  commands: {
    'docusign:discover': DocusignDiscover,
    'docusign:envelopes:create': DocusignEnvelopesCreate,
    'docusign:envelopes:delete': DocusignEnvelopesDelete,
    'docusign:envelopes:download': DocusignEnvelopesDownload,
    'docusign:envelopes:get': DocusignEnvelopesGet,
    'docusign:envelopes:list': DocusignEnvelopesList,
    'docusign:envelopes:view-url': DocusignEnvelopesViewUrl,
    'docusign:introspect': DocusignIntrospect,
  } as Record<string, ProviderCommandClass>,
})
