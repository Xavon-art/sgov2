import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { InviteSetupForm } from "@/components/auth/InviteSetupForm";
import { ButtonLink } from "@/components/ui/Button";
import { callRpc, type RpcResult } from "@/lib/auth/rpc";

type Props = {
  params: Promise<{ token: string }>;
};

/**
 * Step one of the invited flow.
 *
 * The invite is probed on the server so the campus and parent organization can
 * be shown before anyone types a password -- the invitee should be able to see
 * exactly what they are joining.
 */
export default async function InvitePage({ params }: Props) {
  const { token } = await params;

  let probe: RpcResult | null = null;
  try {
    probe = await callRpc<RpcResult>("accept_invite_probe", { p_token: token });
  } catch {
    probe = null;
  }

  if (!probe?.ok) {
    const already = probe?.reason === "already_registered";

    return (
      <AuthShell
        eyebrow="Invitation"
        title={already ? "This account is already active" : "This link is no longer valid"}
        lede={
          already
            ? "You already finished setting up this account. Sign in with your email and password."
            : "The invitation may have expired or been replaced. Ask the officer who invited you to send a fresh link."
        }
      >
        <div className="flex flex-col gap-3">
          <ButtonLink href="/login" size="lg" className="w-full">
            Go to sign in
          </ButtonLink>
          <ButtonLink href="/" variant="outline" size="md" className="w-full">
            Back to home
          </ButtonLink>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="You are invited"
      title="Set your password"
      lede="Choose a password to finish activating your SmartGov account."
    >
      <InviteSetupForm
        token={token}
        email={String(probe.email ?? "")}
        campusName={String(probe.campusName ?? "")}
        organizationName={String(probe.organizationName ?? "")}
        universityName={String(probe.universityName ?? "")}
      />

      <p className="mt-6 text-[0.75rem] leading-relaxed text-muted">
        Trouble with this link?{" "}
        <Link href="/" className="font-medium text-ink underline underline-offset-4">
          Contact your student government
        </Link>{" "}
        and ask them to resend your invitation.
      </p>
    </AuthShell>
  );
}
