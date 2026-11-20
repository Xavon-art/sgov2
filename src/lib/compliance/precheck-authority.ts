import { callRpc, type RpcResult } from "@/lib/auth/rpc";
import type { AuthoritativeItem } from "./precheck-request";

type ProposalDetailResult = RpcResult & {
  proposal?: {
    programId?: string | null;
    requirements?: Array<{
      id?: string;
      label?: string;
    }>;
  };
};

type ProgramsResult = RpcResult & {
  programs?: Array<{
    id?: string;
    items?: Array<Record<string, unknown>>;
  }>;
};

type DefaultsResult = RpcResult & {
  items?: Array<Record<string, unknown>>;
};

type LoadArgs = {
  token: string;
  proposalId?: string;
  programId?: string;
};

export async function loadAuthoritativeItems(
  args: LoadArgs,
): Promise<{ ok: true; items: AuthoritativeItem[] } | { ok: false; reason: string }> {
  if (args.proposalId) {
    const detail = await callRpc<ProposalDetailResult>("proposal_detail", {
      p_session_token: args.token,
      p_proposal_id: args.proposalId,
    });
    if (!detail.ok) return { ok: false, reason: detail.reason ?? "invalid_request" };
    if (!detail.proposal) return { ok: false, reason: "not_found" };

    const items: AuthoritativeItem[] = (detail.proposal.requirements ?? [])
      .filter((item) => item.id && item.label)
      .map((item) => ({
        itemId: item.id!,
        label: item.label!,
        itemKind: "any",
      }));

    const template = detail.proposal.programId
      ? await loadProgramItems(args.token, detail.proposal.programId)
      : await loadDefaultItems(args.token);
    if (!template.ok) return template;

    const merged = mergeItems(items, template.items);
    return merged.length > 0
      ? { ok: true, items: merged }
      : { ok: false, reason: "invalid_request" };
  }

  if (args.programId) {
    const program = await loadProgramItems(args.token, args.programId);
    if (!program.ok) return program;
    return program.items.length > 0
      ? { ok: true, items: program.items }
      : { ok: false, reason: "invalid_request" };
  }

  const defaults = await loadDefaultItems(args.token);
  if (!defaults.ok) return defaults;
  return defaults.items.length > 0
    ? { ok: true, items: defaults.items }
    : { ok: false, reason: "invalid_request" };
}

async function loadProgramItems(
  token: string,
  programId: string,
): Promise<{ ok: true; items: AuthoritativeItem[] } | { ok: false; reason: string }> {
  const result = await callRpc<ProgramsResult>("list_programs", {
    p_session_token: token,
  });
  if (!result.ok) return { ok: false, reason: result.reason ?? "invalid_request" };

  const program = (result.programs ?? []).find((row) => row.id === programId);
  if (!program) return { ok: false, reason: "not_found" };

  return { ok: true, items: templateItems(program.items ?? []) };
}

async function loadDefaultItems(
  token: string,
): Promise<{ ok: true; items: AuthoritativeItem[] } | { ok: false; reason: string }> {
  const result = await callRpc<DefaultsResult>("list_default_requirements", {
    p_session_token: token,
  });
  if (!result.ok) return { ok: false, reason: result.reason ?? "invalid_request" };
  return { ok: true, items: templateItems(result.items ?? []) };
}

function templateItems(rows: Array<Record<string, unknown>>): AuthoritativeItem[] {
  return rows
    .map((row) => {
      const itemId = typeof row.id === "string" ? row.id : "";
      const label = typeof row.label === "string" ? row.label : "";
      const itemKind =
        row.itemKind === "link" ? "link" : row.itemKind === "any" ? "any" : "file";
      return { itemId, label, itemKind } satisfies AuthoritativeItem;
    })
    .filter((item) => item.itemId && item.label);
}

function mergeItems(
  first: AuthoritativeItem[],
  second: AuthoritativeItem[],
): AuthoritativeItem[] {
  const seen = new Set(first.map((item) => item.itemId));
  return [...first, ...second.filter((item) => !seen.has(item.itemId))];
}
