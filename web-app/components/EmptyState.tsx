export default function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body?: string;
  cta?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-sp-card/50 p-10 text-center">
      <div className="text-base font-semibold text-sp-textPrimary">{title}</div>
      {body && <p className="mx-auto mt-2 max-w-md text-sm text-sp-textSecondary">{body}</p>}
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}
