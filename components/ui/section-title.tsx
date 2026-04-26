export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="text-center mb-10">
      <h2 className="text-[clamp(28px,3.5vw,48px)] font-bold mb-2 brand-gradient">{title}</h2>
      {subtitle && <p className="text-[var(--muted)]">{subtitle}</p>}
    </div>
  );
}
