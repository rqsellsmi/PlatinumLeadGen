'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import { Button, Input } from '@/components/ui';
import { updateClosingPhoto } from './actions';

/**
 * Per-sale photo control: upload a file (straight to Vercel Blob) or paste a
 * URL. Either way the resulting URL is saved to the closing's photo_url.
 */
export default function RecentSalePhoto({
  closingId,
  initialUrl,
  address,
}: {
  closingId: number;
  initialUrl: string | null;
  address: string;
}) {
  const router = useRouter();
  const [url, setUrl] = React.useState(initialUrl ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function save(next: string) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('closingId', String(closingId));
      fd.set('photoUrl', next);
      await updateClosingPhoto(fd);
      setUrl(next);
      router.refresh();
    } catch {
      setError('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const blob = await upload(`recent-sales/${closingId}-${safe}`, file, {
        access: 'public',
        handleUploadUrl: '/api/admin/upload',
      });
      await save(blob.url);
    } catch (err) {
      setError(
        err instanceof Error && /token|blob/i.test(err.message)
          ? 'Upload storage not configured yet (Vercel Blob).'
          : 'Upload failed. Try a smaller JP/PNG.',
      );
      setBusy(false);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-1 basis-80 flex-wrap items-center gap-3">
      <div className="h-14 w-20 shrink-0 overflow-hidden rounded-md border border-line bg-line-hair">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={address} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-mute-lighter">
            No photo
          </div>
        )}
      </div>

      <div className="flex flex-1 basis-56 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFile}
            className="hidden"
            aria-label={`Upload photo for ${address}`}
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Working…' : url ? 'Replace photo' : 'Upload photo'}
          </Button>
          {url ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => save('')}>
              Remove
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="…or paste an image URL"
            className="h-8 text-xs"
          />
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => save(url.trim())}>
            Save
          </Button>
        </div>
        {error ? <p className="text-xs text-platinum-red">{error}</p> : null}
      </div>
    </div>
  );
}
