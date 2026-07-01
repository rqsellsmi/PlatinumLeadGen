import { asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { guides, locations, type Guide } from '@/drizzle/schema';
import { Card, CardHeader, CardBody, Button, Input, Label, Textarea, Badge } from '@/components/ui';
import { requireAdmin } from '@/components/admin/requireAdmin';
import ResetOnSubmitForm from '@/components/admin/ResetOnSubmitForm';
import { createGuide, updateGuide, deleteGuide } from './actions';

export const dynamic = 'force-dynamic';

function bulletsToText(json: string | null): string {
  if (!json) return '';
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.join('\n') : '';
  } catch {
    return '';
  }
}
function placementToCsv(json: string): string {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.join(', ') : '';
  } catch {
    return '';
  }
}
function placementList(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function Fields({ g, prefix, slugHint }: { g?: Guide; prefix: string; slugHint: string }) {
  return (
    <>
      <div className="md:col-span-2">
        <Label htmlFor={`${prefix}-title`}>Headline</Label>
        <Input id={`${prefix}-title`} name="title" defaultValue={g?.title ?? ''} placeholder="Sell for more, with less stress" required />
      </div>
      <div>
        <Label htmlFor={`${prefix}-pagesLabel`}>Pages label</Label>
        <Input id={`${prefix}-pagesLabel`} name="pagesLabel" defaultValue={g?.pagesLabel ?? ''} placeholder="24 pages" />
      </div>
      <div className="md:col-span-3">
        <Label htmlFor={`${prefix}-coverTitle`}>Cover title</Label>
        <Input id={`${prefix}-coverTitle`} name="coverTitle" defaultValue={g?.coverTitle ?? ''} placeholder="The Southeast Michigan Home Seller's Guide" />
      </div>
      <div className="md:col-span-3">
        <Label htmlFor={`${prefix}-subtitle`}>Subtitle</Label>
        <Textarea id={`${prefix}-subtitle`} name="subtitle" rows={2} defaultValue={g?.subtitle ?? ''} />
      </div>
      <div className="md:col-span-3">
        <Label htmlFor={`${prefix}-bullets`}>Bullets (one per line)</Label>
        <Textarea id={`${prefix}-bullets`} name="bullets" rows={4} defaultValue={bulletsToText(g?.bulletsJson ?? null)} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor={`${prefix}-fileUrl`}>PDF file URL</Label>
        <Input id={`${prefix}-fileUrl`} name="fileUrl" type="url" defaultValue={g?.fileUrl ?? ''} placeholder="https://…/guide.pdf" required />
      </div>
      <div>
        <Label htmlFor={`${prefix}-ctaLabel`}>Button label</Label>
        <Input id={`${prefix}-ctaLabel`} name="ctaLabel" defaultValue={g?.ctaLabel ?? ''} placeholder="Email me the guide" />
      </div>
      <div className="md:col-span-3">
        <Label htmlFor={`${prefix}-coverImageUrl`}>Cover image URL (optional)</Label>
        <Input id={`${prefix}-coverImageUrl`} name="coverImageUrl" type="url" defaultValue={g?.coverImageUrl ?? ''} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor={`${prefix}-placement`}>Show on pages (comma-separated)</Label>
        <Input id={`${prefix}-placement`} name="placement" defaultValue={g ? placementToCsv(g.placement) : 'home'} placeholder="home" />
        <p className="mt-1 text-xs text-mute-light">
          Use <code>home</code> for the homepage{slugHint ? `, or a city slug: ${slugHint}` : ''}.
        </p>
      </div>
      <div>
        <Label htmlFor={`${prefix}-displayOrder`}>Display order</Label>
        <Input id={`${prefix}-displayOrder`} name="displayOrder" type="number" step="1" defaultValue={g?.displayOrder ?? 0} />
      </div>
      <div className="md:col-span-3">
        <label className="flex items-center gap-2 text-sm text-charcoal">
          <input type="checkbox" name="isActive" defaultChecked={g ? g.isActive : true} /> Active
        </label>
      </div>
    </>
  );
}

export default async function DownloadsAdminPage() {
  await requireAdmin();
  const [list, locs] = await Promise.all([
    db.select().from(guides).orderBy(asc(guides.displayOrder), asc(guides.id)),
    db.select({ slug: locations.slug }).from(locations).orderBy(asc(locations.slug)),
  ]);
  const slugHint = locs.map((l) => l.slug).slice(0, 4).join(', ');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal">Downloads</h1>
        <p className="text-sm text-mute">
          Manage downloadable PDFs (guides) and choose which page(s) each appears on. The homepage
          seller-guide block shows any download assigned to <code>home</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-bold text-charcoal">Add download</h2>
        </CardHeader>
        <CardBody>
          <ResetOnSubmitForm action={createGuide} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Fields prefix="new" slugHint={slugHint} />
            <div className="md:col-span-3">
              <Button type="submit">Add download</Button>
            </div>
          </ResetOnSubmitForm>
        </CardBody>
      </Card>

      <div className="space-y-4">
        {list.length === 0 ? (
          <div className="rounded-card border border-line bg-white px-5 py-12 text-center text-sm text-mute">
            No downloads yet.
          </div>
        ) : null}
        {list.map((g) => (
          <Card key={g.id}>
            <CardBody>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {placementList(g.placement).map((p) => (
                  <Badge key={p} tone="info">
                    {p}
                  </Badge>
                ))}
                {!g.isActive ? <Badge tone="neutral">Hidden</Badge> : null}
              </div>
              <form action={updateGuide} className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <input type="hidden" name="guideId" value={g.id} />
                <Fields g={g} prefix={`g${g.id}`} slugHint={slugHint} />
                <div className="md:col-span-3">
                  <Button type="submit">Save</Button>
                </div>
              </form>
              <form action={deleteGuide} className="mt-3">
                <input type="hidden" name="guideId" value={g.id} />
                <Button type="submit" variant="danger" size="sm">
                  Delete
                </Button>
              </form>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
