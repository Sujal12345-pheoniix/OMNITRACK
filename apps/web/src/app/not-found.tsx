import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-semibold text-primary">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you are looking for does not exist or you do not have access to it.</p>
      <Link href="/" className="mt-2 text-sm font-medium text-primary hover:underline">
        Go to home
      </Link>
    </main>
  );
}
