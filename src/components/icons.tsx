import type { SVGProps } from "react";

// Row-action icons.
//
// These were emoji once (🗑️ / ✎). Emoji are the wrong tool for a control: the
// glyph is drawn by the platform, so the same button is a different picture on
// Windows, Android and iOS; it ignores `currentColor`, so a danger button's red
// never reaches it; and it sits on the text baseline rather than centring in the
// button. An inline SVG is one shape everywhere, inherits the button's colour,
// and scales with its font size.
//
// `aria-hidden` on every icon is deliberate: the accessible name belongs on the
// BUTTON, as an `aria-label`, so a screen reader announces "Hapus pembeli" and
// not "image". Never give one of these its own label.
const base: SVGProps<SVGSVGElement> = {
  width: "1em",
  height: "1em",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function EyeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// The struck-through twin of `EyeIcon`, for a row hidden from the total. The
// slash is what carries the meaning, so it keeps the same eye underneath rather
// than switching to a different picture.
export function EyeOffIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M10.7 5.1A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.7 3.7M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4.5-1.1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

// Dismiss, never delete. `TrashIcon` is the delete action; this closes a panel,
// a drawer, or an in-progress edit.
export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Navigation and status icons (DESIGN.md: one line set, 1.5px stroke,
// currentColor). These replace the emoji that used to sit in the nav and on the
// sync chip. Built by one factory because a dozen copies of the same <svg>
// wrapper say nothing the path data does not.
// ---------------------------------------------------------------------------
function icon(...d: string[]) {
  return function Icon(props: SVGProps<SVGSVGElement>) {
    return (
      <svg {...base} {...props}>
        {d.map((p) => (
          <path key={p} d={p} />
        ))}
      </svg>
    );
  };
}

export const TagIcon = icon("M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z", "M7.5 7.5h.01");
export const BoxIcon = icon("M3 7l9-4 9 4v10l-9 4-9-4z", "M3 7l9 4 9-4", "M12 11v10");
export const UsersIcon = icon(
  "M15 19c0-3-2.7-5-6-5s-6 2-6 5",
  "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  "M16 4.5a3.5 3.5 0 0 1 0 7",
  "M18 14.5c2 .7 3.5 2.5 3.5 5",
);
export const StoreIcon = icon(
  "M4 9l1.5-5h13L20 9",
  "M4 9v11h16V9",
  "M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3",
  "M10 20v-5h4v5",
);
export const CartIcon = icon("M3 4h2.5l2 11h10l2-8H7", "M9 20h.01", "M17 20h.01");
export const ClockIcon = icon("M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2");
export const ChartIcon = icon("M4 20V4", "M4 20h16", "M8 16v-4", "M12 16V8", "M16 16v-6");
export const MoreIcon = icon("M5 12h.01", "M12 12h.01", "M19 12h.01");
export const FileTextIcon = icon(
  "M6 3h8l4 4v14H6z",
  "M14 3v4h4",
  "M9 12h6",
  "M9 16h6",
);
export const SheetIcon = icon(
  "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
  "M4 10h16",
  "M4 15h16",
  "M10 4v16",
);
export const PenToolIcon = icon("M4 20l1-4L16 5l3 3L8 19z", "M14 7l3 3");
export const GearIcon = icon(
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "M12 2v3M12 19v3M2 12h3M19 12h3",
  "M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1",
);
export const CloudIcon = icon("M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5 4.25 4.25 0 0 1 17.5 18z");
export const CloudCheckIcon = icon(
  "M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5 4.25 4.25 0 0 1 17.5 18z",
  "M9.5 13l2 2 3.5-3.5",
);
export const CloudOffIcon = icon(
  "M3 3l18 18",
  "M17.5 18H7a4 4 0 0 1-.6-7.96 6 6 0 0 1 1.2-2.5",
  "M10 5.2A6 6 0 0 1 18 9.5 4.25 4.25 0 0 1 21 13.7",
);
export const AlertIcon = icon(
  "M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  "M12 9v4",
  "M12 17h.01",
);
export const DeviceIcon = icon(
  "M5 3h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
  "M12 18h.01",
);
export const LockIcon = icon(
  "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z",
  "M8 11V8a4 4 0 0 1 8 0v3",
);
export const ArrowUpIcon = icon("M12 19V5", "M5 12l7-7 7 7");
export const ArrowDownIcon = icon("M12 5v14", "M19 12l-7 7-7-7");
export const RefreshIcon = icon(
  "M20 11a8 8 0 0 0-14.9-3M4 5v4h4",
  "M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4",
);
export const CheckCircleIcon = icon(
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  "M8 12.5l2.7 2.7L16 9.5",
);
export const PlusIcon = icon("M12 5v14", "M5 12h14");
export const SearchIcon = icon("M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12z", "M16 16l4.5 4.5");
export const ChevronDownIcon = icon("M6 9l6 6 6-6");
export const DownloadIcon = icon("M12 4v11", "M7 11l5 5 5-5", "M5 20h14");
export const FilterIcon = icon("M4 5h16l-6 7.5V19l-4 1.5v-8z");
