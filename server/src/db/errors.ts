// Small Prisma error helpers shared by the auth flows and jobs.
/** P2002: a unique constraint refused the write (D2: the constraint is the guarantee). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}
