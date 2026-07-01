/**
 * POST /api/admin/upload — issues a short-lived Vercel Blob client-upload token
 * so admins can upload images directly to Blob storage (bypassing the
 * serverless body-size limit). Admin session required. Needs BLOB_READ_WRITE_TOKEN.
 */
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const session = await auth();
        if (!session?.user) throw new Error('Unauthorized');
        return {
          allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
          maximumSizeInBytes: 15 * 1024 * 1024, // 15 MB
        };
      },
      // No post-upload work needed; the URL is saved by the client via a server action.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'upload_failed' },
      { status: 400 },
    );
  }
}
