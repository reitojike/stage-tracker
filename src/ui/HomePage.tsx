import { formatGreeting } from '@/domain/greeting';

export function HomePage() {
  return (
    <main>
      <p>{formatGreeting('stage-tracker')}</p>
    </main>
  );
}
