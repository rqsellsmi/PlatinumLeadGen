'use client';

import * as React from 'react';
import { Card, CardBody, CardHeader, Input, Label } from '@/components/ui';

/** Cost-per-lead calculator (Section 11.2). Admin enters ad spend. */
export default function CplCalculator({ leadsLast30 }: { leadsLast30: number }) {
  const [spend, setSpend] = React.useState('');
  const spendNum = Number(spend) || 0;
  const cpl = leadsLast30 > 0 && spendNum > 0 ? spendNum / leadsLast30 : null;

  return (
    <Card>
      <CardHeader>
        <h2 className="font-bold text-charcoal">Cost-per-lead</h2>
        <p className="text-sm text-mute">Based on {leadsLast30} leads in the last 30 days.</p>
      </CardHeader>
      <CardBody className="space-y-4">
        <div>
          <Label htmlFor="spend">Ad spend (last 30 days)</Label>
          <Input
            id="spend"
            type="number"
            inputMode="decimal"
            placeholder="e.g. 2400"
            value={spend}
            onChange={(e) => setSpend(e.target.value)}
          />
        </div>
        <div className="rounded-card bg-cream px-5 py-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-mute-light">Cost per lead</p>
          <p className="font-numeric text-4xl font-bold text-charcoal">
            {cpl != null ? `$${cpl.toFixed(0)}` : '—'}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
