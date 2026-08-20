import { formatGreeting } from '@/domain/greeting';

interface HomePageProps {
  email: string | null;
}

export function HomePage({ email }: HomePageProps) {
  return (
    <main>
      <p>{formatGreeting('stage-tracker')}</p>
      {email !== null && <p>サインイン中: {email}</p>}
    </main>
  );
}
