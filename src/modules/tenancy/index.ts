export {
  ORG_ROLES,
  ORG_ACTIONS,
  can,
  assignableRoles,
  canAssignRole,
  canManageMember,
} from "./permissions";
export type { OrgRole, OrgAction, MemberActionCheck } from "./permissions";

export {
  ACTIVE_ORG_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  activeOrgCookieAttributes,
  csrfCookieAttributes,
  isSecureOrigin,
} from "./cookie";
export type { CookieAttributes } from "./cookie";

export { verifyCsrf, isSameOriginRequest, timingSafeEqualHex, CSRF_TOKEN_BYTES } from "./csrf";
export type { CsrfCheckResult, OriginCheckInput } from "./csrf";

/**
 * NOTE: ./context and ./team are NOT re-exported here.
 *
 * They import next/headers and the Supabase server client, which cannot exist
 * in a browser bundle. A client component that imported this barrel for a type
 * would drag that server code in and fail the production build — which is
 * exactly what happened once. Import them directly from
 * "@/modules/tenancy/context" in server code instead.
 *
 * isFreshOrgContext is pure, so it lives here where both sides can reach it.
 */
export { isFreshOrgContext } from "./context-shared";
