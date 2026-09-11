// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Prompt One, Inc.
/**
 * Minimal HS256 JSON Web Token sign and verify on node:crypto.
 *
 * Kept deliberately small so the identity provider needs no dependency:
 * one algorithm, exp and nbf checked, nothing else interpreted.
 */
import {createHmac, timingSafeEqual} from 'node:crypto'

export type Claims = Record<string, unknown>

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decode<T>(segment: string, what: string): T {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T
  } catch {
    throw new Error(`malformed token ${what}`)
  }
}

export function signHs256(claims: Claims, secret: string): string {
  const head = encode({alg: 'HS256', typ: 'JWT'})
  const body = encode(claims)
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

export function verifyHs256(token: string, secret: string, nowMs = Date.now()): Claims {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('malformed token')
  const [head, body, sig] = parts
  const header = decode<{alg?: string}>(head, 'header')
  if (header.alg !== 'HS256') throw new Error(`unsupported algorithm ${header.alg ?? '(none)'}`)
  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error('signature mismatch')
  const claims = decode<Claims>(body, 'payload')
  const now = Math.floor(nowMs / 1000)
  if (typeof claims.exp === 'number' && now >= claims.exp) throw new Error('token expired')
  if (typeof claims.nbf === 'number' && now < claims.nbf) throw new Error('token not yet valid')
  return claims
}
