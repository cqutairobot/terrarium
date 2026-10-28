import type { ReactNode } from 'react';

function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const Icon = {
  observe: () => (
    <Svg>
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </Svg>
  ),
  pellet: () => (
    <Svg>
      <circle cx="8" cy="9" r="1.8" />
      <circle cx="15" cy="7.5" r="1.4" />
      <circle cx="12.5" cy="14" r="1.9" />
      <circle cx="7" cy="16.5" r="1.2" />
      <circle cx="17" cy="15.5" r="1.3" />
    </Svg>
  ),
  rich: () => (
    <Svg>
      <path d="M12 3.5c3.2 4 5.5 7.1 5.5 10a5.5 5.5 0 0 1-11 0c0-2.9 2.3-6 5.5-10Z" />
      <path d="M9.6 14.5a2.6 2.6 0 0 0 2.4 2.4" />
    </Svg>
  ),
  spore: () => (
    <Svg>
      <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.6 6.6l2.2 2.2M15.2 15.2l2.2 2.2M6.6 17.4l2.2-2.2M15.2 8.8l2.2-2.2" />
      <circle cx="12" cy="12" r="1.6" />
    </Svg>
  ),
  storm: () => (
    <Svg>
      <path d="M7 15.5a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6 1.5A3.3 3.3 0 0 1 17 15.5Z" />
      <path d="M9 18.5l-1 2M13 18.5l-1 2M17 18.5l-1 2" />
    </Svg>
  ),
  coldwave: () => (
    <Svg>
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <path d="M10 4.5 12 6l2-1.5M10 19.5 12 18l2 1.5" />
    </Svg>
  ),
  heatwave: () => (
    <Svg>
      <circle cx="12" cy="10" r="3.6" />
      <path d="M12 3v1.2M5.6 5.6l.9.9M18.4 5.6l-.9.9M3.5 10h1.2M19.3 10h1.2" />
      <path d="M5 17c1.5-1 2.5-1 4 0s2.5 1 4 0 2.5-1 4 0M5 20.5c1.5-1 2.5-1 4 0s2.5 1 4 0 2.5-1 4 0" />
    </Svg>
  ),
  meteor: () => (
    <Svg>
      <circle cx="15.5" cy="15.5" r="3.2" />
      <path d="M13 13 4 4M15 11.5 9 5.5M11.5 15 5.5 9" />
    </Svg>
  ),
  bloom: () => (
    <Svg>
      <path d="M12 21v-8" />
      <path d="M12 13c0-3.5 2.5-6 6-6 0 3.5-2.5 6-6 6ZM12 15c0-3-2-5-5.5-5 0 3 2 5 5.5 5Z" />
    </Svg>
  ),
  pause: () => (
    <Svg>
      <path d="M9 6v12M15 6v12" />
    </Svg>
  ),
  play: () => (
    <Svg>
      <path d="M8 5.5v13l10-6.5Z" />
    </Svg>
  ),
  sliders: () => (
    <Svg>
      <path d="M5 7h9M18 7h1M5 17h3M12 17h7" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </Svg>
  ),
  stats: () => (
    <Svg>
      <path d="M4 19.5h16" />
      <path d="M5 15.5 9.5 11l3.5 3 6-7" />
    </Svg>
  ),
  log: () => (
    <Svg>
      <path d="M8 6.5h11M8 12h11M8 17.5h7" />
      <circle cx="4.5" cy="6.5" r=".6" />
      <circle cx="4.5" cy="12" r=".6" />
      <circle cx="4.5" cy="17.5" r=".6" />
    </Svg>
  ),
  chronicle: () => (
    <Svg>
      <path d="M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3Z" />
      <path d="M5 17a3 3 0 0 1 3-3h10.5M9 8.5h6" />
    </Svg>
  ),
  archive: () => (
    <Svg>
      <path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z" />
    </Svg>
  ),
  codex: () => (
    <Svg>
      <path d="m12 3 2.3 5.2 5.7.6-4.3 3.8 1.3 5.6L12 15.3 7 18.2l1.3-5.6L4 8.8l5.7-.6Z" />
    </Svg>
  ),
  world: () => (
    <Svg>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.8 9.5c3 1.2 5.6 1.2 8.2 0s5.2-1.2 8.2 0M4.5 15.5c2.8-1 5.2-.8 7.5.3s4.7 1.3 7.5.2" />
    </Svg>
  ),
  sound: () => (
    <Svg>
      <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3Z" />
      <path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 7a7 7 0 0 1 0 10" />
    </Svg>
  ),
  mute: () => (
    <Svg>
      <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3Z" />
      <path d="m16 9.5 4.5 5M20.5 9.5 16 14.5" />
    </Svg>
  ),
  fullscreen: () => (
    <Svg>
      <path d="M4 9V4.5h4.5M15.5 4.5H20V9M20 15v4.5h-4.5M8.5 19.5H4V15" />
    </Svg>
  ),
  hide: () => (
    <Svg>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.6 3.3M6.4 7.7A16.5 16.5 0 0 0 2.5 12S6 18 12 18a9 9 0 0 0 4-.9" />
    </Svg>
  ),
  close: () => (
    <Svg size={18}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  follow: () => (
    <Svg size={18}>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.8" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </Svg>
  ),
  watch: () => (
    <Svg size={18}>
      <path d="m12 4 2.1 4.7 5.1.5-3.9 3.4 1.2 5L12 15 7.5 17.6l1.2-5-3.9-3.4 5.1-.5Z" />
    </Svg>
  ),
  edit: () => (
    <Svg size={16}>
      <path d="M4 20h4L19 9l-4-4L4 16Z" />
    </Svg>
  ),
};
