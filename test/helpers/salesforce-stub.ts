import {createServer, type Server} from 'node:http'

/**
 * A minimal Salesforce stand-in: answers the SOAP login jsforce performs for
 * username/password auth and a REST query, counting each. Enough to prove
 * session caching without touching the network.
 */
export interface SalesforceStub {
  url: string
  logins: number
  queries: number
  /** Mutations received; each hangs until close() so a SIGINT can land mid-flight. */
  mutations: number
  /** Resolves when the first mutation request arrives. */
  mutationStarted: Promise<void>
  close(): Promise<void>
}

export async function startSalesforceStub(): Promise<SalesforceStub> {
  let started: () => void = () => {}
  const stub = {url: '', logins: 0, queries: 0, mutations: 0, mutationStarted: new Promise<void>((r) => {
    started = r
  })} as SalesforceStub
  const open = new Set<import('node:http').ServerResponse>()
  const server: Server = createServer((req, res) => {
    const url = req.url ?? ''
    if (req.method === 'POST' && url.includes('/sobjects/')) {
      stub.mutations++
      open.add(res)
      req.resume()
      started()
      return
    }
    if (req.method === 'POST' && url.startsWith('/services/Soap/u/')) {
      stub.logins++
      res.writeHead(200, {'Content-Type': 'text/xml'})
      res.end(
        '<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="urn:partner.soap.sforce.com"><soapenv:Body><loginResponse><result>' +
          `<serverUrl>${stub.url}/services/Soap/u/59.0/00Dxx</serverUrl><sessionId>STUB-SESSION-${stub.logins}</sessionId><userId>005xx</userId>` +
          '<userInfo><organizationId>00Dxx</organizationId><userName>u@example.com</userName></userInfo>' +
          '</result></loginResponse></soapenv:Body></soapenv:Envelope>',
      )
      return
    }
    if (req.method === 'GET' && url.startsWith('/services/data/') && url.includes('/query')) {
      stub.queries++
      res.writeHead(200, {'Content-Type': 'application/json'})
      res.end(JSON.stringify({totalSize: 1, done: true, records: [{attributes: {type: 'Account'}, Id: '001xx'}]}))
      return
    }
    res.writeHead(404, {'Content-Type': 'application/json'})
    res.end(JSON.stringify([{errorCode: 'NOT_FOUND', message: `stub has no route for ${req.method} ${url}`}]))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('stub did not bind')
  stub.url = `http://127.0.0.1:${addr.port}`
  stub.close = () => {
    for (const res of open) res.destroy()
    server.closeAllConnections()
    return new Promise<void>((resolve) => server.close(() => resolve()))
  }
  return stub
}
