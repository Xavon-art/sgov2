// @ts-nocheck
import type {
  StructureCommittee,
  StructureDocument,
  StructureHolder,
  StructurePosition,
} from "@/lib/structure";

export const ROOT_ID = "__council__";
export const POS_PREFIX = "pos:";

export type OrgNode = {
  id: string;
  name?: string | null;
  title?: string | null;
  course?: string | null;
  yearLevel?: string | null;
  section?: string | null;
  email?: string | null;
  photo?: string | null;
  hasPhoto?: boolean | null;
  parentId?: string | null;
  children?: OrgNode[];
  className?: string;
  collapsed?: boolean;
};

export type OrgDocSnapshot = {
  committees: StructureCommittee[];
  schemaVersion?: number;
  layout?: Record<string, unknown>;
};

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function composeName(holder: StructureHolder | null | undefined): string {
  if (!holder) return "Vacant";
  if (holder.fullName && holder.fullName.trim()) return holder.fullName.trim();
  const parts = [
    holder.firstName?.trim(),
    holder.middleName?.trim(),
    holder.lastName?.trim(),
    holder.suffix?.trim(),
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : holder.email || "Vacant";
}

export function buildHolder(node: OrgNode): StructureHolder {
  return {
    email: (node.email || "").trim(),
    firstName: undefined,
    middleName: undefined,
    lastName: undefined,
    fullName: (node.name || "").trim() || "Vacant",
    nickname: undefined,
    suffix: undefined,
    termNote: undefined,
    birthdate: undefined,
    course: node.course ?? null,
    yearLevel: node.yearLevel ?? null,
    section: node.section ?? null,
    gender: null,
    contactNumber: null,
    address: null,
    photo: node.photo ?? null,
    hasPhoto: !!node.photo || node.hasPhoto === true,
  };
}

export function emptyOrgDocument(unitName: string): StructureDocument {
  return {
    committees: [
      {
        key: "council",
        name: unitName || "Council",
        isUnit: true,
        positions: [],
      },
    ],
  };
}

export function flattenPositions(doc: StructureDocument): StructurePosition[] {
  const out: StructurePosition[] = [];
  for (const committee of doc.committees) {
    for (const position of committee.positions) {
      out.push(position);
    }
  }
  return out;
}

function positionOrderIndex(position: StructurePosition, index: number): number {
  return typeof position.order === "number" && Number.isFinite(position.order)
    ? position.order
    : index;
}

export function toOrgData(
  doc: StructureDocument,
  unitName: string,
  photoUrls: Record<string, string | null>,
): OrgNode[] {
  const positions = flattenPositions(doc);
  const byKey = new Map<string, StructurePosition>();
  positions.forEach((p) => byKey.set(p.key, p));

  const nodesById = new Map<string, OrgNode>();
  const children = new Map<string, OrgNode[]>();
  const roots: OrgNode[] = [];

  positions.forEach((position, index) => {
    const holder = position.holder || (position.holders?.[0] ?? null);
    const email = (holder?.email || "").trim().toLowerCase();
    const node: OrgNode = {
      id: `${POS_PREFIX}${position.key}`,
      name: composeName(holder),
      title: position.title || "",
      course: holder?.course ?? null,
      yearLevel: holder?.yearLevel ?? null,
      section: holder?.section ?? null,
      email: holder?.email ?? null,
      photo: holder?.photo ?? null,
      hasPhoto: holder?.hasPhoto ?? !!holder?.photo ?? false,
      parentId: position.parentKey ? `${POS_PREFIX}${position.parentKey}` : ROOT_ID,
      order: positionOrderIndex(position, index),
      className: "org-seat",
    };
    nodesById.set(node.id, node);
    const photoUrl = photoUrls[email] ?? photoUrls[position.key] ?? null;
    if (photoUrl) node.photo = photoUrl;
    if (!position.parentKey || !byKey.has(position.parentKey)) roots.push(node);
    else {
      if (!children.has(position.parentKey)) children.set(position.parentKey, []);
      children.get(position.parentKey)!.push(node);
    }
  });

  const attach = (node: OrgNode): void => {
    const kids = (children.get(node.id) || [])
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (kids.length) {
      node.children = kids;
      kids.forEach(attach);
    }
  };

  roots.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach(attach);

  return [
    {
      id: ROOT_ID,
      name: unitName || "Council",
      title: "Council",
      course: null,
      yearLevel: null,
      section: null,
      email: null,
      photo: null,
      hasPhoto: false,
      parentId: null,
      children: roots,
      className: "org-root",
      collapsed: false,
    },
  ];
}

export function fromOrgData(hierarchy: OrgNode[], prevDoc: StructureDocument): StructureDocument {
  const positions: StructurePosition[] = [];

  const walk = (node: OrgNode, depth: number, parentKey: string | null): void => {
    if (node.id === ROOT_ID) {
      (node.children || []).forEach((child) => walk(child, depth, parentKey));
      return;
    }
    const key = node.id.startsWith(POS_PREFIX) ? node.id.slice(POS_PREFIX.length) : node.id;
    positions.push({
      key,
      title: (node.title || "").trim() || "Untitled position",
      description: undefined,
      holder: buildHolder(node),
      holders: node.name ? [buildHolder(node)] : [],
      tier: Math.max(0, Math.min(12, depth)),
      order: positions.filter((p) => p.parentKey === parentKey).length,
      parentKey,
      group: null,
      maxHolders: 1,
    });
    (node.children || []).forEach((child) => walk(child, depth + 1, key));
  };

  hierarchy.forEach((root) => walk(root, 1, null));

  return {
    ...prevDoc,
    committees: [
      {
        key: "council",
        name: prevDoc.committees?.[0]?.name || "Council",
        isUnit: true,
        positions,
      },
    ],
  };
}

export function newPosition(parentKey: string | null, unitName: string): StructurePosition {
  const siblings = []; // order assigned by caller
  return {
    key: newId("pos"),
    title: "New position",
    description: undefined,
    holder: null,
    holders: [],
    tier: 1,
    order: 0,
    parentKey,
    group: null,
    maxHolders: 1,
  };
}

export function positionChildrenCount(
  positions: StructurePosition[],
  parentKey: string | null,
): number {
  return positions.filter((p) => p.parentKey === parentKey).length;
}

export function removePositionAndDescendants(
  positions: StructurePosition[],
  key: string,
): StructurePosition[] {
  const toRemove = new Set<string>([key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of positions) {
      if (p.parentKey && toRemove.has(p.parentKey) && !toRemove.has(p.key)) {
        toRemove.add(p.key);
        changed = true;
      }
    }
  }
  return positions.filter((p) => !toRemove.has(p.key));
}

export function updatePositionByKey(
  doc: StructureDocument,
  key: string,
  updater: (position: StructurePosition) => StructurePosition,
): StructureDocument {
  const positions = flattenPositions(doc).map((p) =>
    p.key === key ? updater(p) : p,
  );
  return fromOrgData(
    toOrgData(
      { ...doc, committees: [{ key: "council", name: doc.committees?.[0]?.name || "Council", isUnit: true, positions }] },
      doc.committees?.[0]?.name || "Council",
      {},
    ),
    doc,
  );
}

export type AddPositionResult = {
  doc: StructureDocument;
  position: StructurePosition;
};

export function addPositionToDoc(
  doc: StructureDocument,
  parentKey: string | null,
  unitName: string,
): AddPositionResult {
  const positions = flattenPositions(doc);
  const next = newPosition(parentKey, unitName);
  next.order = positionChildrenCount(positions, parentKey);
  const docResult = fromOrgData(
    toOrgData(
      {
        ...doc,
        committees: [
          {
            key: "council",
            name: doc.committees?.[0]?.name || unitName || "Council",
            isUnit: true,
            positions: [...positions, next],
          },
        ],
      },
      unitName,
      {},
    ),
    doc,
  );
  return { doc: docResult, position: next };
}

export function removePositionFromDoc(doc: StructureDocument, key: string): StructureDocument {
  const positions = removePositionAndDescendants(flattenPositions(doc), key);
  return fromOrgData(
    toOrgData(
      {
        ...doc,
        committees: [
          {
            key: "council",
            name: doc.committees?.[0]?.name || "Council",
            isUnit: true,
            positions,
          },
        ],
      },
      doc.committees?.[0]?.name || "Council",
      {},
    ),
    doc,
  );
}

export function isDescendant(
  positions: StructurePosition[],
  sourceKey: string,
  possibleAncestor: string | null,
): boolean {
  let current: StructurePosition | undefined = positions.find((p) => p.key === sourceKey);
  while (current) {
    if (current.parentKey === possibleAncestor) return true;
    current = positions.find((p) => p.key === current.parentKey);
  }
  return false;
}

export function applyOrgMove(
  doc: StructureDocument,
  sourceNodeId: string,
  targetNodeId: string,
  unitName: string,
): StructureDocument {
  const positions = flattenPositions(doc);
  const sourceKey =
    sourceNodeId.startsWith(POS_PREFIX) ? sourceNodeId.slice(POS_PREFIX.length) : sourceNodeId;
  const targetKey =
    targetNodeId === ROOT_ID
      ? null
      : targetNodeId.startsWith(POS_PREFIX)
      ? targetNodeId.slice(POS_PREFIX.length)
      : targetNodeId;
  const source = positions.find((p) => p.key === sourceKey);
  if (!source || sourceKey === targetKey) return doc;
  if (isDescendant(positions, sourceKey, targetKey)) return doc;

  const next = positions.map((p) =>
    p.key === sourceKey ? { ...p, parentKey: targetKey } : p,
  );
  const targetChildrenCount = positionChildrenCount(next, targetKey);
  const indexed = next.map((p) =>
    p.key === sourceKey ? { ...p, order: targetChildrenCount } : p,
  );
  return fromOrgData(
    toOrgData(
      { ...doc, committees: [{ key: "council", name: unitName || "Council", isUnit: true, positions: indexed }] },
      unitName,
      {},
    ),
    doc,
  );
}
