// Server components only. Inlined at build time via next.config.mjs `env`, because the runtime image does not carry build-stage ENV.
const API_BASE = `${process.env.API_INTERNAL_URL ?? 'http://localhost:4100'}/api/v1`;

export type PublicOrganization = { name: string; slug: string };

/** Public careers profile of an active organization, or null when it does not exist or is not active. */
export async function getPublicOrganization(slug: string): Promise<PublicOrganization | null> {
  const res = await fetch(`${API_BASE}/public/organizations/${encodeURIComponent(slug)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Organization lookup failed with status ${res.status}`);
  return (await res.json()) as PublicOrganization;
}
