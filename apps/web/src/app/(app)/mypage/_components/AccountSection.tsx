import { Button, SectionHeading } from "@stage-tracker/ui";
import { signOut } from "@/app/sign-out/actions";

/**
 * Exact My Page rendering for a failed email read is owned by this component;
 * account/access semantics remain in Spec 009.
 */
export function AccountSection({ email }: { email: string | null }) {
  return (
    <section
      aria-labelledby="mypage-account-heading"
      className="flex flex-col gap-sm border-b-2 border-border pb-lg"
    >
      <SectionHeading id="mypage-account-heading">アカウント</SectionHeading>
      {email !== null ? (
        <p className="text-body-sm text-muted-foreground">{email}</p>
      ) : null}
      <form action={signOut}>
        <Button type="submit" variant="outline">
          サインアウト
        </Button>
      </form>
    </section>
  );
}
