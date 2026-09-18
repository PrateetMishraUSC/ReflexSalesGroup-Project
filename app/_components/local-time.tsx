// Shows a timestamp in the viewer's own time zone.
"use client";

export function LocalTime({ iso }: { iso: string }) {
  const text = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
