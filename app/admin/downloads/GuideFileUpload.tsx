'use client';

import * as React from 'react';
import { upload } from '@vercel/blob/client';
import { Button, Label } from '@/components/ui';

/**
 * Upload control for a guide's PDF or cover image. Uploads straight to Vercel
 * Blob and puts the resulting URL into a hidden input (submitted with the guide
 * form's server action). No URL typing — a button, as requested.
 */
export default function GuideFileUpload({
  name,
  label,
  kind,
  initialUrl,
  required,
}: {
  name: string; // hidden field name: 'fileUrl' | 'coverImageUrl'
  label: string;
  kind: 'pdf' | 'image';
  initialUrl: string | null;
  required?: boolean;
}) {
  const [url, setUrl] = React.useState(initialUrl ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const accept = kind === 'pdf' ? 'application/pdf' : 'image/*';

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const blob = await upload(`guides/${kind}-${safe}`, file, {
        access: 'public',
        handleUploadUrl: '/api/admin/upload',
      });
      setUrl(blob.url);
    } catch (err) {
      setError(
        err instanceof Error && /token|blob/i.test(err.message)
          ? 'Upload storage not configured yet (Vercel Blob).'
          : 'Upload failed. Try again.',
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const fileName = url ? decodeURIComponent(url.split('/').pop() ?? '') : '';

  return (
    <div>
      <Label>
        {label}
        {required ? ' *' : ''}
      </Label>
      <input type="hidden" name={name} value={url} />
      <div className="flex flex-wrap items-center gap-3">
        {kind === 'image' && url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="cover" className="h-14 w-20 rounded-md border border-line object-cover" />
        ) : null}
        <input ref={fileRef} type="file" accept={accept} onChange={onFile} className="hidden" />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? 'Uploading…' : url ? `Replace ${kind === 'pdf' ? 'PDF' : 'image'}` : `Upload ${kind === 'pdf' ? 'PDF' : 'image'}`}
        </Button>
        {url ? (
          <>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-[240px] truncate text-sm font-semibold text-platinum-blue hover:underline"
            >
              {fileName || 'View file'}
            </a>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setUrl('')}>
              Remove
            </Button>
          </>
        ) : (
          <span className="text-xs text-mute-light">No file yet</span>
        )}
      </div>
      {error ? <p className="mt-1 text-xs text-platinum-red">{error}</p> : null}
    </div>
  );
}
