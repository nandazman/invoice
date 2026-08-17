// Regenerates public/*.png from brand/logo.png. Run by hand — icons change
// about as often as the company does — with `node scripts/generate-icons.mjs`
// from the repo root.
//
// sharp is NOT a dependency of this project; it happens to be present as a
// transitive one. If this fails to import, `bun add -d sharp` and try again.
// It is deliberately not in package.json: a native image library is a heavy
// thing to make every install pay for, when the outputs it produces are
// committed and the script runs perhaps once a year.
//
// The measurements below came from scanning the source's centre row and column
// for the ring strokes. They are specific to this artwork; a new logo needs
// them taken again rather than adjusted by feel.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const SRC = "brand/logo.png";
const OUT = "public";
mkdirSync(OUT, { recursive: true });
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

// The inner ring of the seal, measured off the source by scanning the centre
// row and column for the thin circle strokes. Everything outside it is the
// double border and the arced "SUMARA NIAGA SUPPLIER" text, none of which is
// legible at 32px and all of which is what made the icon look like whitespace
// with a smudge in it.
const CX = 1125;
const CY = 1041;
// Well inside the stroke, which sits at r=544..559. Cutting at 552 landed in
// the middle of it and left the inner half behind as a faint circle — which
// then also stopped the trim below, because the artwork was no longer the
// outermost dark thing in the frame.
const R = 535;

const meta = await sharp(SRC).metadata();
const { width: W, height: H } = meta;

// Paint everything outside that circle white. A plain rectangular crop cannot
// do this: the circle's bounding square has the ring arcs running through its
// corners, so the border would survive in all four of them.
const mask = Buffer.from(
  `<svg width="${W}" height="${H}"><path fill="white" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M${CX} ${CY} m-${R} 0 a${R} ${R} 0 1 0 ${R * 2} 0 a${R} ${R} 0 1 0 -${R * 2} 0"/></svg>`,
);

// Then trim the white back to the artwork itself. This is the "remove the
// whitespace" step — without it the icon is still the truck floating in the
// middle of a square field of nothing.
// Rendered to exact pixels first: sharp rasterises SVG at its own density and
// can land a pixel over, which composite rejects outright.
const maskPng = await sharp(mask).resize(W, H, { fit: "fill" }).png().toBuffer();

// Two passes on purpose. sharp orders its pipeline trim -> resize -> composite
// regardless of the order the calls are written in, so chaining these would
// trim the untouched source first and then try to composite a full-size mask
// onto the smaller result.
const masked = await sharp(SRC)
  .composite([{ input: maskPng, blend: "over" }])
  .png()
  .toBuffer();

const art = await sharp(masked)
  .trim({ background: "#ffffff", threshold: 12 })
  .png()
  .toBuffer();

const trimmed = await sharp(art).metadata();
console.log("artwork after trim:", trimmed.width + "x" + trimmed.height);

// Square it on white, so every later resize is a plain scale.
const side = Math.max(trimmed.width, trimmed.height);
const square = await sharp(art)
  .resize(side, side, { fit: "contain", background: WHITE })
  .png()
  .toBuffer();

// Near full-bleed. These are the tab icon and the install icon, both small, and
// margin at that size is wasted pixels.
async function plain(size, name, fill = 0.98) {
  const inner = Math.round(size * fill);
  await sharp({ create: { width: size, height: size, channels: 3, background: WHITE } })
    .composite([
      {
        input: await sharp(square).resize(inner, inner, { kernel: "lanczos3" }).png().toBuffer(),
        gravity: "centre",
      },
    ])
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}/${name}`);
  console.log(name, size, "fill", fill);
}

for (const [size, name] of [
  [16, "favicon-16.png"],
  [32, "favicon-32.png"],
  [180, "apple-touch-icon.png"],
  [192, "pwa-192.png"],
  [512, "pwa-512.png"],
]) {
  await plain(size, name);
}

// Maskable keeps its margin, and this is the one place margin is not waste:
// Android crops to the launcher's shape, and art outside the central 80% safe
// zone is what gets cut. 72% is as tight as a circular crop allows.
await plain(512, "maskable-512.png", 0.72);
