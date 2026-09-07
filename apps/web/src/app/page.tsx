import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1 className="text-2xl font-semibold">stage-tracker v2</h1>
      <Button>Hello, stage-tracker</Button>
    </main>
  );
}
