/**
 * The assistant's mark — a construction robot: a robot head under a hard hat.
 *
 * A generic chat-bot head or a sparkle says "AI" and nothing about the work. A hard hat is the one
 * object everybody on a site recognises, and on a robot it says what this assistant is for.
 * Drawn on the 24px grid lucide icons use, in `currentColor` with the same stroke, so it sits beside
 * them without looking borrowed.
 */

export function AdvisorMark({ size = 16, strokeWidth = 1.8, className }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Hard hat: the dome, its ridge, and the brim. */}
      <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0" />
      <path d="M12 4v2.5" />
      <path d="M4 9.5h16" />
      {/* The head under it. */}
      <rect x="6.5" y="11.5" width="11" height="8.5" rx="2.5" />
      {/* Visor eyes and a grille mouth. */}
      <circle cx="10" cy="15.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14" cy="15.2" r="0.9" fill="currentColor" stroke="none" />
      <path d="M10.5 18h3" />
      {/* Bolts at the sides. */}
      <path d="M4.5 15.5h2" />
      <path d="M17.5 15.5h2" />
    </svg>
  );
}
