/** Vector slipper mark: crisp at any size, unlike the 1254px raster logo it replaces in headers. */
export function SliperMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path
        fill="#fff"
        d="M3.8 18.2c0-1.3.8-1.9 2.4-2 2.8-.2 5.2.4 7.6.5l2.6-4.1c.5-.8 1.2-1.1 1.9-.8 1.6.6 3.2 1.4 4.4 2.2.4.3.5.8.5 1.4 0 1.2.3 2.1 1.2 2.2 1 .1 2.1-.3 3-.5.6-.1.9.3.9.9 0 1.7-1.9 2.5-4.7 2.5H8.2c-2.8 0-4.4-.7-4.4-2.3Z"
      />
    </svg>
  );
}
