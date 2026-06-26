'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
import { Button, Input, Textarea, Label } from '@/components/ui';
import type { FaqItem } from '@/lib/seo';
import { saveSeo, type SaveSeoState } from '@/app/admin/locations/[id]/seo/actions';

interface SeoFormProps {
  locationId: number;
  initial: {
    metaTitle: string;
    metaDescription: string;
    heroHeadline: string;
    heroSubheadline: string;
    guideUrl: string;
    faq: FaqItem[];
  };
}

const initialState: SaveSeoState = {};

function CharCounter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={`text-xs ${over ? 'font-semibold text-brand-red' : 'text-slate-400'}`}>
      {value.length}/{max}
      {over ? ' — over recommended length' : ''}
    </span>
  );
}

export function SeoForm({ locationId, initial }: SeoFormProps) {
  const [state, action] = useFormState(saveSeo, initialState);
  const [metaTitle, setMetaTitle] = useState(initial.metaTitle);
  const [metaDescription, setMetaDescription] = useState(initial.metaDescription);
  const [faq, setFaq] = useState<FaqItem[]>(initial.faq);

  function updateFaq(i: number, key: keyof FaqItem, val: string) {
    setFaq((prev) => prev.map((item, idx) => (idx === i ? { ...item, [key]: val } : item)));
  }
  function addFaq() {
    setFaq((prev) => [...prev, { question: '', answer: '' }]);
  }
  function removeFaq(i: number) {
    setFaq((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="locationId" value={locationId} />
      {/* Serialize FAQ to a single JSON field validated server-side. */}
      <input type="hidden" name="faqJson" value={JSON.stringify(faq)} />

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="metaTitle">Meta title</Label>
          <CharCounter value={metaTitle} max={60} />
        </div>
        <Input
          id="metaTitle"
          name="metaTitle"
          value={metaTitle}
          onChange={(e) => setMetaTitle(e.target.value)}
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="metaDescription">Meta description</Label>
          <CharCounter value={metaDescription} max={160} />
        </div>
        <Textarea
          id="metaDescription"
          name="metaDescription"
          rows={3}
          value={metaDescription}
          onChange={(e) => setMetaDescription(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="heroHeadline">Hero headline</Label>
        <Input id="heroHeadline" name="heroHeadline" defaultValue={initial.heroHeadline} />
      </div>

      <div>
        <Label htmlFor="heroSubheadline">Hero subheadline</Label>
        <Textarea id="heroSubheadline" name="heroSubheadline" rows={2} defaultValue={initial.heroSubheadline} />
      </div>

      <div>
        <Label htmlFor="guideUrl">Seller guide URL</Label>
        <Input id="guideUrl" name="guideUrl" type="url" defaultValue={initial.guideUrl} />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="mb-0">FAQ</Label>
          <Button type="button" variant="outline" size="sm" onClick={addFaq}>
            + Add question
          </Button>
        </div>
        {faq.length === 0 && <p className="text-sm text-slate-400">No FAQ items yet.</p>}
        {faq.map((item, i) => (
          <div key={i} className="space-y-2 rounded-md border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">Item {i + 1}</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeFaq(i)}>
                Remove
              </Button>
            </div>
            <Input
              placeholder="Question"
              value={item.question}
              onChange={(e) => updateFaq(i, 'question', e.target.value)}
            />
            <Textarea
              placeholder="Answer"
              rows={2}
              value={item.answer}
              onChange={(e) => updateFaq(i, 'answer', e.target.value)}
            />
          </div>
        ))}
      </div>

      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{state.error}</p>
      )}
      {state.success && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">SEO saved.</p>
      )}

      <Button type="submit">Save SEO</Button>
    </form>
  );
}
