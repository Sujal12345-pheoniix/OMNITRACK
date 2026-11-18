'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        <h1>Something went wrong</h1>
        <p>The application failed to load. Try again, and contact support if the problem continues.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
