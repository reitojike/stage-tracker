import { LoadingIndicator } from '@/ui/LoadingIndicator';

export default function EventDetailLoading() {
  return (
    <main>
      <LoadingIndicator label="公演情報を読み込み中" />
    </main>
  );
}
