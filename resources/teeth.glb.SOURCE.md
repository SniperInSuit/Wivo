# teeth.glb — where it came from

**Source model:** TurboSquid #1804670, *"Teeth - Mouth Interior Real Time"*
by **meminmamon**. Purchased 2026-10-27 under the TurboSquid **Standard
License**, which is included with every purchase and covers royalty-free use
in commercial business projects worldwide.

One clause worth remembering rather than rediscovering: under Standard, model
rights are assignable **only with TurboSquid's permission**. That matters on
exactly one day — if Wivo is ever sold to somebody else, the model rights have
to be assigned with them. The Small Business tier ($99) includes assignable
rights outright. Nothing to do today; just do not let it be a surprise then.

## What was changed

Produced by `scripts/teeth-to-glb.mjs` from the purchased archive. Run it
again to rebuild:

```
node scripts/teeth-to-glb.mjs <path-to-purchased-archive-root>
```

- 32 teeth recovered as separate nodes and named `tooth_11` … `tooth_48`.
  **The source has no object names at all** — no `o`, no `g`, no `usemtl`, just
  one flat vertex soup. The teeth are 32 geometrically disconnected shells, so
  identity is recovered from position instead. See the script header.
- Built from the **closed-bite** variant: the arches nest, so the model is
  4.55 cm tall instead of 8.08 and fills a panel rather than floating in it.
  Same triangle count either way — the saving is screen space, not bytes.
- Gums kept as a single `gingiva` node, teeth centred on their own bounding box.
- Three of the five 4096² TGA maps kept and embedded: DIFFUSE and NORMAL at
  1024², ORM at 512². `baseColorFactor` stays white so a tooth can be tinted by
  work type without the texture fighting the colour.
- THICKNESS and CAVITY dropped (subsurface scattering, which this renderer does
  not do), along with the tongue, the ZBrush high-poly, the Marmoset scene and
  the closed-mouth variant.
- 20,328 vertices · 36,516 triangles · ~4.0 MB.

The purchased archive itself is **not** in this repo. The licence covers
shipping the model inside Wivo, not republishing the source files.
