import type { ReactNode } from 'react';

const paths = {
  undo: 'M9 5 4 10l5 5M4 10h9a6 6 0 0 1 6 6v3',
  redo: 'm15 5 5 5-5 5m5-5h-9a6 6 0 0 0-6 6v3',
  open: 'M3 19V5h7l2 3h9v11H3Zm0 0 4-8h14',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  save: 'M4 3h13l3 3v15H4V3Zm3 0v6h9V3M8 21v-7h8v7',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm0 4v6m0 3v1',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18',
  chat: 'M3 4h18v13H9l-6 4V4Z',
  magnify: 'M16 16 22 22M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 4v6m-3-3h6',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
  clear: 'M5 5l14 14M19 5 5 19',
  collapse: 'M4 4h16v16H4V4Zm4 8h8',
  expand: 'M4 4h16v16H4V4Zm4 8h8m-4-4v8',
  move: 'M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4m12-8 4 4-4 4',
  unlock: 'M7 11V7a5 5 0 0 1 9-3M5 11h14v10H5V11Zm7 4v3',
  shape: 'M3 19V5h8v14h10M3 19C3 1 21 23 21 5',
} as const;

export function ActionLabel({ icon, children }: { icon: keyof typeof paths; children: ReactNode }) {
  return (
    <>
      <svg
        className="action-icon"
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={paths[icon]} />
      </svg>
      <span className="action-label">{children}</span>
    </>
  );
}
