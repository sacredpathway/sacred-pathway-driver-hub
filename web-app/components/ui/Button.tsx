// Button + ButtonLink — the shared action styles for the whole app.
// Variants: primary (brand gold), secondary (outlined), ghost (text), danger.
// Every size keeps a ≥40px touch target on mobile (h-10) except "sm" in dense
// desktop tables, which still meets 32px + surrounding padding.

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-colors " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sp-gold " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-sp-gold text-sp-black hover:bg-sp-goldLight",
  secondary: "border border-white/10 bg-white/[0.03] text-sp-textPrimary hover:border-white/20 hover:bg-white/[0.07]",
  ghost: "text-sp-textSecondary hover:bg-white/[0.06] hover:text-sp-textPrimary",
  danger: "border border-sp-danger/40 text-sp-danger hover:bg-sp-danger/10",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  return cx(BASE, VARIANTS[variant], SIZES[size], extra);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: Omit<ComponentProps<typeof Link>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
