import type { Launch } from '@/lib/types/launch';
import { normalizeImageUrl } from '@/lib/utils/imageUrl';

type ProviderLogoInput = Pick<Launch, 'providerLogoUrl' | 'providerImageUrl' | 'rocket'>;

export function resolveProviderLogoUrl(launch: ProviderLogoInput): string | undefined {
  const raw =
    launch.providerLogoUrl ||
    launch.providerImageUrl ||
    launch.rocket?.manufacturerLogoUrl ||
    launch.rocket?.manufacturerImageUrl;
  return normalizeImageUrl(raw);
}
