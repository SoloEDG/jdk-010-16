import type { LabDocument, SolidLensSpec } from "../../../shared/document";
import { glassCatalog } from "../../optics/lib/materials";
export function saveDocument(doc: LabDocument) {
  localStorage.setItem("lumen-document", JSON.stringify(doc));
}
const KNOWN_MATERIALS = new Set(glassCatalog.map((g) => g.id));
function sanitizeLens(raw: unknown): SolidLensSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const l = raw as Record<string, unknown>;
  if (l.model !== "solid") return undefined;
  const r1 = Number(l.r1);
  const r2 = Number(l.r2);
  const thickness = Number(l.thickness);
  if (
    !Number.isFinite(r1) ||
    !Number.isFinite(r2) ||
    !Number.isFinite(thickness) ||
    thickness <= 0
  )
    return undefined;
  const material =
    typeof l.material === "string" && KNOWN_MATERIALS.has(l.material)
      ? l.material
      : "BK7";
  return { model: "solid", material, r1, r2, thickness };
}
export function loadDocument(): LabDocument | null {
  try {
    const v = JSON.parse(localStorage.getItem("lumen-document") ?? "null");
    if (v?.version !== 1 || !Array.isArray(v.items) || v.items.length > 80)
      return null;
    const items = [];
    for (const raw of v.items) {
      if (
        !["source", "mirror", "lens", "prism", "screen"].includes(raw.kind) ||
        typeof raw.id !== "string"
      )
        return null;
      for (const k of [
        "x",
        "y",
        "angle",
        "size",
        "power",
        "rays",
        "spread",
        "wavelength",
        "focal",
        "index",
      ])
        if (!Number.isFinite(raw[k])) return null;
      if (
        raw.rays < 1 ||
        raw.rays > 41 ||
        raw.size <= 0 ||
        raw.focal === 0 ||
        raw.index < 1
      )
        return null;
      const e = { ...raw };
      // 无 lens 字段的旧存档天然按薄透镜恢复
      const lens = sanitizeLens(raw.lens);
      if (lens) e.lens = lens;
      else delete e.lens;
      items.push(e);
    }
    return { version: 1, items };
  } catch {
    return null;
  }
}
