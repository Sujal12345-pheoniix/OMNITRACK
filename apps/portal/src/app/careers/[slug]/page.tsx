import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicOrganization } from '@/lib/api';

type Props = { params: Promise<{ slug: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const org = await getPublicOrganization((await params).slug);
  return { title: org ? org.name : 'Not found' };
}

export default async function CareersPage({ params }: Props) {
  const org = await getPublicOrganization((await params).slug);
  if (!org) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 px-4 py-12 sm:px-6">
      <p className="text-sm font-semibold text-primary">Careers</p>
      <h1 className="text-3xl font-semibold tracking-tight">{org.name}</h1>
      <p className="text-sm text-muted-foreground">There are no open roles right now. Check back soon.</p>
    </main>
  );
}
