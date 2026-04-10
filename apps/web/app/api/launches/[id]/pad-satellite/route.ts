import { respondWithPadSatellitePreviewByLaunchId } from '@/lib/server/padSatellitePreview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return respondWithPadSatellitePreviewByLaunchId(params.id);
}
