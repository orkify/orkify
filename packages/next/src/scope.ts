import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Cache entries outlive a deploy (primary memory survives `orkify reload`, the
 * file layer survives restarts). Entries rendered by a previous build link that
 * build's hashed chunks, which 404 in the new release — so every key the Next
 * handlers write is scoped to the current deployment.
 *
 * Old builds' entries are never read again; the TTL below ages them out, so no
 * sweep ever has to touch the store (it is shared with the app's own cache use).
 */
export const ENTRY_MAX_TTL = 7 * 24 * 60 * 60; // seconds

let scope: string | undefined;

/**
 * The current deployment's id: `NEXT_DEPLOYMENT_ID` (set per deploy by orkify),
 * else Next's `.next/BUILD_ID` (plain `orkify up` / `run`), else `default`.
 */
export function deploymentScope(): string {
  if (scope !== undefined) return scope;
  scope = process.env.NEXT_DEPLOYMENT_ID || readBuildId() || 'default';
  return scope;
}

function readBuildId(): string | undefined {
  try {
    return readFileSync(join(process.cwd(), '.next', 'BUILD_ID'), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Test hook — forget the memoized scope. */
export function _resetDeploymentScope(): void {
  scope = undefined;
}
