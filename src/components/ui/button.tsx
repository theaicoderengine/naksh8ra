import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

const variants = {
  primary: "bg-primary text-primary-fg hover:bg-primary/90 shadow-sm",
  secondary: "bg-surface text-fg border border-border hover:bg-muted",
  ghost: "text-fg hover:bg-muted",
  danger: "bg-danger text-white hover:bg-danger/90",
  subtle: "bg-primary-soft text-primary hover:bg-primary-soft/70",
  link: "text-primary underline-offset-4 hover:underline px-0",
};
const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-sm", lg: "h-12 px-6 text-base", icon: "h-9 w-9" };

type Common = { variant?: keyof typeof variants; size?: keyof typeof sizes; loading?: boolean; className?: string };

export const buttonClass = (variant: keyof typeof variants = "primary", size: keyof typeof sizes = "md", className?: string) =>
  cn("inline-flex items-center justify-center gap-2 rounded font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap", variants[variant], sizes[size], className);

export const Button = React.forwardRef<HTMLButtonElement, Common & React.ButtonHTMLAttributes<HTMLButtonElement>>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = "primary", size = "md", className, children, ...rest }: Common & { href: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
