import { notFound } from 'next/navigation';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export async function requireAdminViewer() {
  const session = await resolveViewerSession();
  if (session.role !== 'admin') {
    notFound();
  }
  return session;
}
