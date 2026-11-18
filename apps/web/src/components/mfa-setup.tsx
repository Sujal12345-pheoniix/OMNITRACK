'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Copy, Download, ShieldCheck } from 'lucide-react';
import type { MfaSetupResponse } from '@omnitrack/contracts';
import { Button, FormField, Input, Spinner, toast } from '@omnitrack/ui';
import { FormAlert } from '@/components/common';
import { fieldErrors, post } from '@/lib/api';

/**
 * TOTP enrolment: show QR + secret, confirm with a code, then show recovery codes once.
 * `onDone` runs after the user has acknowledged the recovery codes.
 */
export function MfaSetup({ onDone }: { onDone: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);

  const setup = useMutation({
    mutationFn: () => post<MfaSetupResponse>('/me/mfa/totp/setup'),
    onSuccess: async (s) => setQr(await QRCode.toDataURL(s.otpauthUrl, { margin: 1, width: 192 })),
  });
  const enable = useMutation({
    mutationFn: () => post<{ recoveryCodes: string[] }>('/me/mfa/totp/enable', { code: code.trim() }),
    onSuccess: (r) => setRecovery(r.recoveryCodes),
  });

  // Each setup call stores a new secret, so it must run exactly once (strict mode runs effects twice).
  const started = useRef(false);
  const { mutate: startSetup } = setup;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startSetup();
  }, [startSetup]);

  if (recovery) {
    const text = recovery.join('\n');
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-success">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          <p className="font-semibold">Two-factor authentication is on</p>
        </div>
        <p className="text-sm text-muted-foreground">
          Save these recovery codes somewhere safe. Each works once if you lose your device. They will not be shown again.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/50 p-3 font-mono text-sm" data-testid="recovery-codes">
          {recovery.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => toast({ title: 'Recovery codes copied' }));
            }}
          >
            <Copy aria-hidden="true" /> Copy
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([`OmniTrack recovery codes\n\n${text}\n`], { type: 'text/plain' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = 'omnitrack-recovery-codes.txt';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download aria-hidden="true" /> Download
          </Button>
        </div>
        <Button className="w-full" onClick={onDone}>
          I have saved my recovery codes
        </Button>
      </div>
    );
  }

  if (setup.isError) return <FormAlert error={setup.error} />;
  if (!setup.data || !qr) return <Spinner label="Preparing setup" />;

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        enable.mutate();
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Open an authenticator app (for example Microsoft Authenticator or Google Authenticator).</li>
        <li>Scan the QR code, or enter the key by hand.</li>
        <li>Enter the 6-digit code it shows.</li>
      </ol>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated locally */}
        <img src={qr} alt="QR code for your authenticator app" width={160} height={160} className="rounded-md border border-border bg-white p-1" />
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium">Setup key</p>
          <code data-testid="mfa-secret" className="block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
            {setup.data.secret}
          </code>
        </div>
      </div>
      <FormField label="6-digit code" htmlFor="mfa-code" required error={fieldErrors(enable.error).code}>
        <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
      </FormField>
      {enable.error && !fieldErrors(enable.error).code ? <FormAlert error={enable.error} /> : null}
      <Button type="submit" className="w-full" loading={enable.isPending}>
        Turn on two-factor authentication
      </Button>
    </form>
  );
}
