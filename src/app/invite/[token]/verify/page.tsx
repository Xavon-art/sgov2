import { Suspense } from "react";
import { OtpVerify } from "@/components/auth/OtpVerify";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function InviteVerifyPage({ params }: Props) {
  const { token } = await params;

  return (
    <Suspense fallback={<div className="min-h-[40vh]" aria-hidden />}>
      <OtpVerify token={token} />
    </Suspense>
  );
}
