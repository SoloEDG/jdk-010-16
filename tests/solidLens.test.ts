import { test } from "node:test";
import assert from "node:assert/strict";
import type { Element, LabDocument } from "../src/shared/document";
import { dot } from "../src/shared/geometry";
import { trace } from "../src/features/optics/lib/trace";
import { nearestSurface } from "../src/features/optics/lib/surfaces";
import {
  buildSolidSpec,
  effectiveFocalLength,
  frame,
  intersectSolid,
  toWorld,
  validateSolid,
} from "../src/features/optics/lib/solidLens";
import { glassIndex } from "../src/features/optics/lib/materials";
import { reflect, refract } from "../src/features/optics/lib/refraction";

const base = (id: string, kind: Element["kind"], x: number, y: number): Element => ({
  id,
  kind,
  x,
  y,
  angle: kind === "source" ? 0 : 90,
  size: 180,
  power: 1,
  rays: 9,
  spread: 0,
  wavelength: 550,
  focal: 180,
  index: 1.52,
});

test("thin lens trace is unchanged after the refactor", () => {
  const doc: LabDocument = {
    version: 1,
    items: [
      { ...base("s", "source", 100, 300), size: 100 },
      { ...base("l", "lens", 400, 300), size: 200, focal: 150 },
      { ...base("d", "screen", 550, 300), size: 200 },
    ],
  };
  const r = trace(doc);
  assert.equal(r.hits.length, 9);
  assert.ok(r.hits.every((h) => Math.abs(h.position) < 0.01));
  assert.equal(r.warnings.length, 0);
});

test("lensmaker effective focal length is consistent with the generated geometry", () => {
  // 小口径下曲率保护不会触发，EFL 应回到设计焦距
  const lens: Element = {
    ...base("l", "lens", 400, 300),
    size: 80,
    lens: buildSolidSpec(260, 80),
  };
  const efl = effectiveFocalLength(lens);
  assert.ok(efl !== null);
  assert.ok(Math.abs(efl! - 260) < 3, `efl=${efl}`);
  assert.ok(validateSolid(lens).valid);
});

test("generated solid spec always yields a valid solid for the full aperture range", () => {
  for (const size of [40, 120, 200, 300]) {
    const lens: Element = {
      ...base("l", "lens", 400, 300),
      size,
      lens: buildSolidSpec(180, size),
    };
    const v = validateSolid(lens);
    assert.ok(v.valid, `size=${size} reasons=${v.reasons.join(";")}`);
  }
});

test("solid biconvex lens focuses paraxial rays near its EFL and shows spherical aberration at the paraxial screen", () => {
  const lens: Element = {
    ...base("l", "lens", 400, 300),
    size: 200,
    lens: buildSolidSpec(200, 200),
  };
  const efl = effectiveFocalLength(lens)!;
  const screenAtEfl: Element = {
    ...base("d", "screen", 400 + efl, 300),
    size: 260,
  };
  const doc: LabDocument = {
    version: 1,
    items: [
      { ...base("s", "source", 100, 300), size: 160, rays: 21 },
      lens,
      screenAtEfl,
    ],
  };
  const r = trace(doc);
  assert.ok(r.hits.length >= 18);
  const withPower = r.hits;
  const mean =
    withPower.reduce((s, h) => s + h.position * h.power, 0) /
    withPower.reduce((s, h) => s + h.power, 0);
  // 近轴焦点附近，光斑质心应基本位于光轴
  assert.ok(Math.abs(mean) < 4, `mean=${mean}`);
  // 大口径实体透镜在近轴焦面上必有非零弥散（球差），薄透镜理想模型为 0
  assert.ok(
    withPower.some((h) => Math.abs(h.position) > 0.5),
    "expected non-zero spherical aberration spread",
  );
});

test("front, rear and wall surfaces are distinguished", () => {
  // 平凸实体：前表面球面 R1=160，后表面平面 x=20，口径 100
  const lens: Element = {
    ...base("l", "lens", 0, 0),
    size: 100,
    lens: { model: "solid", material: "BK7", r1: 160, r2: 0, thickness: 20 },
  };
  assert.ok(validateSolid(lens).valid);
  // 外部沿 +x 光线先命中前表面
  const front = intersectSolid(lens, { x: -50, y: 10 }, { x: 1, y: 0 });
  assert.equal(front?.surface, "front");
  assert.ok(front!.t > 0);
  // 内部光线命中后表面（平面）
  const rear = intersectSolid(lens, { x: 10, y: 10 }, { x: 1, y: 0 });
  assert.equal(rear?.surface, "rear");
  // 内部几乎沿口径方向传播的光线：起点贴近后表面平面（该区域前表面很薄），
  // 在到达任何球面前先命中 y=±50 的侧壁
  const wallDir = (() => {
    const l = Math.hypot(0.01, 1);
    return { x: 0.01 / l, y: 1 / l };
  })();
  const wall = intersectSolid(lens, { x: 16, y: 0 }, wallDir);
  assert.equal(wall?.surface, "wall");
});

test("total internal reflection keeps the ray inside glass instead of forcing exit", () => {
  // n=1.52 时临界角约 41.1°，取 50° 入射角必发生全反射
  const n = glassIndex("BK7", 550);
  const normal = { x: -Math.cos(0.8727), y: Math.sin(0.8727) };
  assert.equal(refract({ x: 1, y: 0 }, normal, n, 1), null);

  // 平面后表面实体：直接从玻璃内部以 55° 射向平面，
  // 经 nearestSurface 求交后由 Snell 判定 TIR，光线必须反射回内部而非穿出
  const lens: Element = {
    ...base("l", "lens", 0, 0),
    size: 100,
    lens: { model: "solid", material: "BK7", r1: 160, r2: 0, thickness: 20 },
  };
  assert.ok(validateSolid(lens).valid);
  // 内部射线：局部坐标 (10,0) 出发，方向与后表面法线（+x）成 55°
  const angle = (55 * Math.PI) / 180;
  const localDir = { x: Math.cos(angle), y: Math.sin(angle) };
  const { axis, tangent } = frame(lens);
  const origin = toWorld(lens, { x: 10, y: 0 });
  const worldDir = {
    x: localDir.x * axis.x + localDir.y * tangent.x,
    y: localDir.x * axis.y + localDir.y * tangent.y,
  };
  const hit = nearestSurface([lens], origin, worldDir, true);
  assert.ok(hit && hit.surface === "rear");
  const transmitted = refract(worldDir, hit!.normal, n, 1);
  assert.equal(transmitted, null); // 全反射，无透射方向
  const reflected = reflect(worldDir, hit!.normal);
  // 反射后轴向分量反向：光线回到玻璃内部
  assert.ok(dot(reflected, axis) < 0);
});

test("wall reflection is traced end-to-end and never exits through the cylindrical side", () => {
  const lens: Element = {
    ...base("l", "lens", 400, 300),
    size: 100,
    lens: { model: "solid", material: "BK7", r1: 160, r2: -160, thickness: 18 },
  };
  assert.ok(validateSolid(lens).valid);
  // 光源位于透镜内部，发射几乎沿口径方向的光线，先命中侧壁并反射
  const origin = toWorld(lens, { x: 9, y: 0 });
  const { axis, tangent } = frame(lens);
  const local = (() => {
    const l = Math.hypot(0.01, 1);
    return { x: 0.01 / l, y: 1 / l };
  })();
  const worldAngle =
    (Math.atan2(
      local.x * axis.y + local.y * tangent.y,
      local.x * axis.x + local.y * tangent.x,
    ) *
      180) /
    Math.PI;
  const doc: LabDocument = {
    version: 1,
    items: [
      {
        ...base("s", "source", origin.x, origin.y),
        angle: worldAngle,
        size: 1,
        rays: 1,
        spread: 0,
      },
      lens,
    ],
  };
  const r = trace(doc);
  const wall = r.warnings.find((w) => w.code === "wall-hit");
  assert.ok(wall && wall.count >= 1);
  // 反射后仍产生后续光路段，追迹没有被强制终止或穿出
  assert.ok(r.segments.length >= 2);
});

test("invalid solid lens is skipped in tracing and reports a recoverable warning", () => {  const lens: Element = {
    ...base("l", "lens", 400, 300),
    size: 200,
    // 曲率半径小于口径半径，球面无法覆盖口径
    lens: { model: "solid", material: "BK7", r1: 30, r2: -30, thickness: 4 },
  };
  const validation = validateSolid(lens);
  assert.equal(validation.valid, false);
  const doc: LabDocument = {
    version: 1,
    items: [
      { ...base("s", "source", 100, 300), size: 100 },
      lens,
      { ...base("d", "screen", 800, 300), size: 300 },
    ],
  };
  const r = trace(doc);
  assert.ok(r.warnings.some((w) => w.code === "invalid-solid"));
  // 透镜被跳过，光线直行仍可到达屏幕，场景可恢复
  assert.equal(r.hits.length, 9);
});

test("switching back to thin lens restores the original optical result", () => {
  const thin: LabDocument = {
    version: 1,
    items: [
      { ...base("s", "source", 100, 300), size: 120, rays: 13 },
      { ...base("l", "lens", 400, 300), size: 200, focal: 160 },
      { ...base("d", "screen", 620, 300), size: 240 },
    ],
  };
  const baseline = trace(thin);
  const solid: LabDocument = {
    ...thin,
    items: thin.items.map((e) =>
      e.id === "l" ? { ...e, lens: buildSolidSpec(e.focal, e.size) } : e,
    ),
  };
  // 实体模型与薄透镜不保证等价：焦面落点允许不同
  const solidResult = trace(solid);
  assert.ok(solidResult.segments.length > 0);
  // 撤销切换（移除 lens 字段）后光路必须与原任务完全一致
  const restored: LabDocument = {
    ...solid,
    items: solid.items.map((e) =>
      e.id === "l" ? (() => {
        const { lens: _lens, ...rest } = e;
        return rest;
      })() : e,
    ),
  };
  const restoredResult = trace(restored);
  assert.deepEqual(
    restoredResult.segments.map((s) => [s.from, s.to]),
    baseline.segments.map((s) => [s.from, s.to]),
  );
  assert.deepEqual(restoredResult.hits, baseline.hits);
});
