import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-800 disabled:bg-neutral-300",
  secondary: "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 disabled:text-neutral-400",
  ghost: "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:text-neutral-300",
  danger: "text-red-700 hover:bg-red-50 disabled:text-neutral-300",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        buttonStyles[variant],
        className,
      )}
    >
      {loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm text-neutral-900 placeholder:text-neutral-400",
        "focus:border-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-200",
        className,
      )}
    />
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-lg border border-neutral-200 bg-white", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-3.5">
          <div>
            {title && <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

type Tone = "neutral" | "positive" | "negative" | "warning" | "info";

const badgeStyles: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-700 ring-neutral-200",
  positive: "bg-green-50 text-green-800 ring-green-200",
  negative: "bg-red-50 text-red-800 ring-red-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  info: "bg-blue-50 text-blue-800 ring-blue-200",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", badgeStyles[tone])}>
      {children}
    </span>
  );
}

const alertIcon = { info: Info, warning: TriangleAlert, negative: CircleAlert, positive: CircleCheck, neutral: Info };

export function Alert({ tone = "info", children }: { tone?: Exclude<Tone, "neutral">; children: ReactNode }) {
  const Icon = alertIcon[tone];
  return (
    <div role={tone === "negative" ? "alert" : "status"} className={cx("flex gap-2 rounded-md px-3 py-2.5 text-sm ring-1 ring-inset", badgeStyles[tone])}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="num mt-0.5 text-sm font-medium text-neutral-900">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-neutral-500">{sub}</dd>}
    </div>
  );
}

export function Signed({ value, children }: { value: number | null | undefined; children: ReactNode }) {
  const color = value == null || value === 0 ? "text-neutral-700" : value > 0 ? "text-green-700" : "text-red-700";
  return <span className={cx("num", color)}>{children}</span>;
}
