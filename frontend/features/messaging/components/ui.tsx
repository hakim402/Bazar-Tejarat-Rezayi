"use client";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../../../components/ui/icon";
import type { Locale } from "../../../lib/i18n/locales";
import { AccountError } from "../../../lib/api/private-client";
import { mediaUrl } from "../../marketplace/api";
import { usePublicProduct } from "../product";
import { communicationCopy } from "../copy";

// Single visual language for buyer + seller messaging (theme-aware, RTL-safe).
export const panel =
	"min-w-0 rounded-2xl border border-border bg-surface shadow-sm";
export const actionBtn =
	"inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-action no-underline shadow-sm transition-colors hover:border-action hover:bg-info disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none";
export const primaryBtn =
	"inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-transparent bg-primary px-5 py-2 text-sm font-semibold text-on-primary no-underline shadow-sm transition-colors hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none";
export const iconBtn =
	"inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border bg-surface text-action no-underline shadow-sm transition-colors hover:border-action hover:bg-info disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none";
export const field =
	"min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 py-2 text-base text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-50";
export const badge =
	"inline-flex shrink-0 items-center gap-1 rounded-full bg-info px-2.5 py-1 text-xs font-semibold text-action";
export const help = "text-sm leading-relaxed text-muted";
const segBtn =
	"inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-info hover:text-action disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none";
const segBtnActive = "border-border bg-surface text-action shadow-sm";

export function failureMessage(locale: Locale, error: unknown): string {
	const t = communicationCopy[locale];
	if (!(error instanceof AccountError)) return t.failed;
	switch (error.status) {
		case 404:
			return t.denied;
		case 401:
		case 403:
			return t.expired;
		case 400:
			return t.invalid;
		case 409:
			return t.conflict;
		case 429:
			return t.throttled;
		default:
			return t.failed;
	}
}

export function Failure({ locale, error }: { locale: Locale; error: unknown }) {
	return (
		<p
			role="alert"
			className="rounded-xl border border-danger bg-surface p-3 text-sm text-danger"
		>
			{failureMessage(locale, error)}
		</p>
	);
}

export function Avatar({
	label,
	className = "size-11 text-sm",
}: {
	label: string;
	className?: string;
}) {
	const initials =
		label
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((word) => word[0] ?? "")
			.join("") || "•";
	return (
		<span
			aria-hidden="true"
			className={`flex shrink-0 items-center justify-center rounded-full bg-info font-bold text-action ${className}`}
		>
			{initials}
		</span>
	);
}

export function ProductAvatar({
	locale,
	product,
	label,
}: {
	locale: Locale;
	product: string;
	label: string;
}) {
	const value = usePublicProduct(locale, product);
	const cover = value?.images[0];
	if (cover)
		return (
			// biome-ignore lint/performance/noImgElement: cached public marketplace cover rendered as a small inbox avatar.
			<img
				src={mediaUrl(cover.url)}
				alt={cover.alt}
				className="size-11 shrink-0 rounded-full border border-border object-cover"
			/>
		);
	return <Avatar label={label} />;
}

export function EmptyState({
	icon = "inbox",
	title,
	help: helpText,
	children,
}: {
	icon?: IconName;
	title: string;
	help?: string;
	children?: ReactNode;
}) {
	return (
		<section
			className={`${panel} flex flex-col items-center gap-3 px-6 py-12 text-center`}
		>
			<span className="flex size-12 items-center justify-center rounded-2xl bg-info text-action">
				<Icon name={icon} className="size-6" />
			</span>
			<h2 className="text-lg font-semibold">{title}</h2>
			{helpText && <p className={`${help} mx-auto max-w-lg`}>{helpText}</p>}
			{children}
		</section>
	);
}

export function Segmented<T extends string>({
	value,
	onChange,
	options,
	ariaLabel,
}: {
	value: T;
	onChange: (value: T) => void;
	options: readonly { value: T; label: string; icon?: IconName }[];
	ariaLabel: string;
}) {
	return (
		<fieldset
			aria-label={ariaLabel}
			className="m-0 inline-flex min-w-0 flex-wrap gap-0.5 rounded-lg border border-border bg-page p-0.5"
		>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					aria-pressed={value === option.value}
					onClick={() => onChange(option.value)}
					className={`${segBtn} ${value === option.value ? segBtnActive : ""}`}
				>
					{option.icon && <Icon name={option.icon} className="size-3.5" />}
					{option.label}
				</button>
			))}
		</fieldset>
	);
}
