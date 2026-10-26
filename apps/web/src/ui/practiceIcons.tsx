// Icons for the practice screens, drawn like ui/icons.tsx: 24px grid, 2px stroke, currentColor.
const props = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const HeadphonesIcon = () => (
  <svg {...props}>
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
    <rect x="3.5" y="14" width="4.5" height="6.5" rx="1.8" />
    <rect x="16" y="14" width="4.5" height="6.5" rx="1.8" />
  </svg>
);

export const EarIcon = () => (
  <svg {...props}>
    <path d="M7 9a5.5 5.5 0 0 1 11 0c0 3-2.5 4-3.5 5.5S13.5 19 11 19a2.8 2.8 0 0 1-2.6-1.8" />
    <path d="M10 9.5a2.5 2.5 0 0 1 5 0c0 1.4-1.3 2-1.8 2.6" />
  </svg>
);

/** A rising-falling contour: shadowing and intonation. */
export const WaveIcon = () => (
  <svg {...props}>
    <path d="M3 15c2.5 0 3-6 6-6s3.5 8 6.5 8S19 11 21 11" />
  </svg>
);

export const ChevronIcon = () => (
  <svg {...props}>
    <path d="m9.5 6 6 6-6 6" />
  </svg>
);

/** Four options, one of them right: picking from options. */
export const ChoiceIcon = () => (
  <svg {...props}>
    <rect x="4" y="4" width="7" height="7" rx="2" />
    <rect x="13" y="4" width="7" height="7" rx="2" />
    <rect x="4" y="13" width="7" height="7" rx="2" />
    <path d="m14 16.5 2 2 3.5-4" />
  </svg>
);

/** A pen: typing the word in Hangul. */
export const PenIcon = () => (
  <svg {...props}>
    <path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
    <path d="M13.5 6.5l3 3" />
  </svg>
);
