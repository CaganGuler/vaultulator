import { useLocalSearchParams } from 'expo-router';

import { parseFilter, parseOldestFirst } from '@/lib/media/gallery-order';
import { MediaViewerScreen } from '@/screens/media-viewer';

export default function MediaViewerRoute() {
  const { id, filter, order } = useLocalSearchParams<{ id: string; filter?: string; order?: string }>();
  return <MediaViewerScreen id={id} filter={parseFilter(filter)} oldestFirst={parseOldestFirst(order)} />;
}
