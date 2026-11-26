import { NextResponse } from "next/server";
import { canonicalFormsPublicPath, listPublicFeedbackForms } from "@/lib/feedback-forms";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  try {
    const res = await listPublicFeedbackForms();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, message: "We could not load published feedback forms." },
        { status: 400, headers: NO_STORE },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        forms: (res.forms ?? []).map((form) => ({
          ...form,
          publicPath: canonicalFormsPublicPath(form.publicPath),
        })),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[feedback-public:list]", error);
    return NextResponse.json(
      { ok: false, message: "We could not load published feedback forms." },
      { status: 500, headers: NO_STORE },
    );
  }
}
