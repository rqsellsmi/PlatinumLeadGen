'use client';

import * as React from 'react';
import { Button, Card, CardBody, CardHeader, Badge } from '@/components/ui';
import {
  uploadClosings,
  recomputeMetrics,
  deleteAllClosings,
  getClosingsByBatch,
  deleteBatch,
  type UploadSummary,
} from '@/app/admin/data-upload/actions';

type Role = 'listing' | 'buyer';

export interface BatchRow {
  id: number;
  agentRole: string;
  fileName: string | null;
  rowsImported: number;
  rowsSkipped: number;
  rowsErrored: number;
  earliestCloseDate: string | null;
  latestCloseDate: string | null;
  createdAt: string | null;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US');
}

function UploadTab({ role, label }: { role: Role; label: string }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [summary, setSummary] = React.useState<UploadSummary | null>(null);

  async function handleUpload() {
    if (!file) return;
    setBusy(true);
    setSummary(null);
    try {
      const text = await file.text();
      const result = await uploadClosings(role, text, file.name);
      setSummary(result);
      setFile(null);
    } catch {
      setSummary({
        ok: false,
        imported: 0,
        skipped: 0,
        errored: 0,
        errors: ['Upload failed. Please try again.'],
        message: 'Upload failed.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="font-bold text-charcoal">{label}</h3>
        <p className="mt-1 text-xs text-mute-light">
          CSV export from your MLS. Columns are matched flexibly; dedup is by MLS number within{' '}
          {role} side.
        </p>
      </CardHeader>
      <CardBody className="space-y-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-mute file:mr-3 file:rounded-md file:border-0 file:bg-charcoal file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white"
        />
        <Button onClick={handleUpload} disabled={!file || busy} className="w-full">
          {busy ? 'Importing…' : `Upload ${label}`}
        </Button>
        {summary ? (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              summary.ok ? 'border-success/30 bg-success/5 text-charcoal' : 'border-platinum-red/30 bg-danger-bg text-platinum-red'
            }`}
          >
            <p className="font-semibold">{summary.message}</p>
            {summary.errors.length > 0 ? (
              <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-xs text-mute">
                {summary.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function BatchHistory({ batches }: { batches: BatchRow[] }) {
  const [openId, setOpenId] = React.useState<number | null>(null);
  const [rows, setRows] = React.useState<Record<number, Array<Record<string, unknown>>>>({});
  const [loading, setLoading] = React.useState(false);

  async function toggle(id: number) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!rows[id]) {
      setLoading(true);
      try {
        const data = await getClosingsByBatch(id);
        setRows((r) => ({ ...r, [id]: data as Array<Record<string, unknown>> }));
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="font-bold text-charcoal">Upload history</h3>
      </CardHeader>
      <CardBody className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-charcoal text-white">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-left font-semibold">Role</th>
                <th className="px-3 py-2 text-left font-semibold">File</th>
                <th className="px-3 py-2 text-right font-semibold">Imported</th>
                <th className="px-3 py-2 text-right font-semibold">Skipped</th>
                <th className="px-3 py-2 text-right font-semibold">Errored</th>
                <th className="px-3 py-2 text-left font-semibold">Close range</th>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-hair">
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-mute">
                    No uploads yet.
                  </td>
                </tr>
              ) : null}
              {batches.map((b) => (
                <React.Fragment key={b.id}>
                  <tr className="hover:bg-cream/50">
                    <td className="px-3 py-2">{fmtDate(b.createdAt)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={b.agentRole === 'listing' ? 'info' : 'neutral'}>{b.agentRole}</Badge>
                    </td>
                    <td className="px-3 py-2 text-mute">{b.fileName ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-numeric">{b.rowsImported}</td>
                    <td className="px-3 py-2 text-right font-numeric">{b.rowsSkipped}</td>
                    <td className="px-3 py-2 text-right font-numeric">{b.rowsErrored}</td>
                    <td className="px-3 py-2 text-mute">
                      {fmtDate(b.earliestCloseDate)} – {fmtDate(b.latestCloseDate)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => toggle(b.id)}
                          className="text-xs font-semibold text-platinum-blue hover:underline"
                        >
                          {openId === b.id ? 'Hide' : 'View'}
                        </button>
                        <DeleteBatchButton batchId={b.id} />
                      </div>
                    </td>
                  </tr>
                  {openId === b.id ? (
                    <tr>
                      <td colSpan={8} className="bg-cream/40 px-3 py-3">
                        {loading && !rows[b.id] ? (
                          <p className="text-xs text-mute">Loading…</p>
                        ) : (
                          <div className="max-h-72 overflow-auto">
                            <table className="min-w-full text-xs">
                              <thead className="text-mute-light">
                                <tr>
                                  <th className="px-2 py-1 text-left">Close</th>
                                  <th className="px-2 py-1 text-left">Address</th>
                                  <th className="px-2 py-1 text-left">District</th>
                                  <th className="px-2 py-1 text-right">List</th>
                                  <th className="px-2 py-1 text-right">Sale</th>
                                  <th className="px-2 py-1 text-right">DOM</th>
                                  <th className="px-2 py-1 text-left">MLS</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(rows[b.id] ?? []).map((c, i) => (
                                  <tr key={i} className="border-t border-line-hair">
                                    <td className="px-2 py-1">{fmtDate(String(c.closeDate ?? ''))}</td>
                                    <td className="px-2 py-1">{String(c.address ?? '')}</td>
                                    <td className="px-2 py-1">{String(c.schoolDistrict ?? '—')}</td>
                                    <td className="px-2 py-1 text-right">{String(c.listPrice ?? '—')}</td>
                                    <td className="px-2 py-1 text-right">{String(c.salePrice ?? '')}</td>
                                    <td className="px-2 py-1 text-right">{String(c.daysOnMarket ?? '—')}</td>
                                    <td className="px-2 py-1">{String(c.mlsNumber ?? '—')}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function DeleteBatchButton({ batchId }: { batchId: number }) {
  return (
    <form
      action={deleteBatch}
      onSubmit={(e) => {
        if (!confirm('Delete this batch and its closings? Metrics will be recomputed.')) e.preventDefault();
      }}
      className="inline"
    >
      <input type="hidden" name="batchId" value={batchId} />
      <button type="submit" className="text-xs font-semibold text-platinum-red hover:underline">
        Delete
      </button>
    </form>
  );
}

export default function DataUploadClient({ batches }: { batches: BatchRow[] }) {
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  async function onRecompute() {
    setBusy(true);
    try {
      const r = await recomputeMetrics();
      setToast(r.message);
    } finally {
      setBusy(false);
    }
  }

  async function onClearAll() {
    if (!confirm('Delete ALL closings and batches and reset metrics? This cannot be undone.')) return;
    setBusy(true);
    try {
      await deleteAllClosings();
      setToast('All closings cleared and metrics reset.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Data Upload</h1>
          <p className="text-sm text-mute">
            Import MLS closings to recompute market stats and auto-populate recent sales.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onRecompute} disabled={busy}>
            {busy ? 'Working…' : 'Update Metrics'}
          </Button>
          <Button variant="danger" onClick={onClearAll} disabled={busy}>
            Clear All Closings
          </Button>
        </div>
      </div>

      {toast ? (
        <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-charcoal">
          {toast}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <UploadTab role="listing" label="Listing Closings" />
        <UploadTab role="buyer" label="Buyer Closings" />
      </div>

      <BatchHistory batches={batches} />
    </div>
  );
}
