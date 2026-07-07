'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents } from '@/drizzle/schema';
import { getCurrentAgent } from '@/lib/agentSession';
import { geocodeAddress } from '@/lib/geocode';

/**
 * Save an agent's lead-routing proximity preferences: the anchor their
 * acceptance distance is measured from (office or a personal city) and how far
 * they'll accept leads. The city is geocoded to coordinates on save.
 */
export async function updateRoutingPreferences(formData: FormData) {
  const agent = await getCurrentAgent();
  if (!agent) throw new Error('Not signed in');

  const anchor = String(formData.get('proximityAnchor') ?? 'office') === 'custom' ? 'custom' : 'office';
  const city = String(formData.get('locationCity') ?? '').trim() || null;

  const radiusRaw = String(formData.get('radiusMiles') ?? '').trim();
  const radiusNum = radiusRaw === '' ? null : Number(radiusRaw);
  const radiusMiles = radiusNum != null && Number.isFinite(radiusNum) && radiusNum > 0 ? radiusNum : null;

  // Geocode the custom city so proximity has coordinates to work from. If it
  // doesn't resolve (or no city given), coordinates stay null and routing falls
  // back to the office anchor for this agent.
  let latitude: number | null = agent.latitude;
  let longitude: number | null = agent.longitude;
  if (anchor === 'custom') {
    if (city) {
      const geo = await geocodeAddress({ city });
      latitude = geo ? geo.lat : null;
      longitude = geo ? geo.lng : null;
    } else {
      latitude = null;
      longitude = null;
    }
  }

  await db
    .update(agents)
    .set({
      proximityAnchor: anchor,
      locationCity: city,
      latitude,
      longitude,
      proximityRadiusMiles: radiusMiles,
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agent.id));

  revalidatePath('/agent/settings');
}
