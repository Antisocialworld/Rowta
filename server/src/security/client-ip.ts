// Client address for rate-limit keys (skill rowta-rate-limiting-recipes section 5, S13).
//
// The IP is taken from the socket, or from X-Forwarded-For ONLY according to TRUST_PROXY_HOPS
// (the number of proxies in front). A fake X-Forwarded-For header must never change the key when
// TRUST_PROXY_HOPS is 0, which is the local default.
// IPv6 addresses are grouped by their /64 prefix so one host cannot walk its whole range.
import type { Context } from 'hono';
import { env } from '../config/env.ts';

interface NodeLikeContext {
  env?: { incoming?: { socket?: { remoteAddress?: string } } };
}

function socketAddress(c: Context): string | undefined {
  const nodeEnv = (c as unknown as NodeLikeContext).env;
  const address = nodeEnv?.incoming?.socket?.remoteAddress;
  return typeof address === 'string' && address.length > 0 ? address : undefined;
}

/** Group IPv6 by /64 (first four groups); everything else is used as-is. */
export function normaliseAddress(address: string): string {
  if (address.includes(':')) {
    const groups = address.split(':').slice(0, 4);
    return `${groups.join(':')}::/64`;
  }
  return address;
}

function fromForwardedFor(header: string, hops: number): string | undefined {
  const parts = header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return undefined;
  // Hops counted from the right: with N trusted proxies the client is at index length - N.
  const index = parts.length - hops;
  const candidate = index >= 0 ? parts[index] : undefined;
  return candidate ?? undefined;
}

export function clientIp(c: Context): string {
  const hops = env.TRUST_PROXY_HOPS;
  if (hops > 0) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded !== undefined) {
      const candidate = fromForwardedFor(forwarded, hops);
      if (candidate !== undefined) return normaliseAddress(candidate);
    }
  }
  const socket = socketAddress(c);
  return socket !== undefined ? normaliseAddress(socket) : 'unknown';
}
