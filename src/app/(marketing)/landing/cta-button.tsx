/* Shared Request Access pill. TODO: point at the real request-access flow
 * (form/email destination) once decided; for now it scrolls to the final
 * CTA band (#request-access). */
export function RequestAccessButton({
  onDark,
  small,
}: {
  onDark?: boolean;
  small?: boolean;
}) {
  const size = small ? "px-4 py-2 text-sm" : "px-8 py-4 text-base";
  const look = onDark
    ? "bg-white text-(--lp-ink) hover:bg-amber-50"
    : "bg-(--lp-cta) text-white hover:bg-(--lp-cta-hover)";
  return (
    <a
      href="#request-access"
      className={`rounded-full font-semibold transition-all hover:-translate-y-0.5 ${size} ${look}`}
    >
      Request Access
    </a>
  );
}
