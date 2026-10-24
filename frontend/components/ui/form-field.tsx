import type { ComponentProps, ReactNode } from "react";
export const inputClass =
	"w-full min-w-0 min-h-13.5 rounded-control border border-control bg-surface focus:border-action text-foreground px-3.5 py-2.5 font-normal";
export function Input({
	className = "",
	compact = false,
	...props
}: ComponentProps<"input"> & { compact?: boolean }) {
	return (
		<input
			id={props.id ?? `field-${props.name}`}
			className={`${compact ? "w-full min-w-0 min-h-10 rounded-control border border-control bg-surface focus:border-action text-foreground px-3 py-2 text-sm font-normal" : inputClass} ${props.dir === "ltr" ? "font-identifier" : ""} ${className}`}
			{...props}
		/>
	);
}
export function Select({ className = "", ...props }: ComponentProps<"select">) {
	return (
		<select
			id={props.id ?? `field-${props.name}`}
			className={`${inputClass} ${className}`}
			{...props}
		/>
	);
}
export function Field({
	compact = false,
	id,
	name,
	label,
	children,
}: {
	name: string;
	compact?: boolean;
	id?: string;
	label: ReactNode;
	children: ReactNode;
}) {
	return (
		<label
			htmlFor={id ?? `field-${name}`}
			className={`account-field flex flex-col text-sm ${compact ? "my-0.5 gap-1 font-medium" : "my-2 gap-2 font-bold"}`}
		>
			{label}
			{children}
		</label>
	);
}
export function CheckField({
	compact = false,
	label,
	...props
}: ComponentProps<"input"> & { label: ReactNode; compact?: boolean }) {
	return (
		<label
			className={`account-check flex cursor-pointer items-start ${compact ? "gap-2 py-1 text-xs leading-5" : "gap-3 py-3 text-base leading-relaxed"}`}
		>
			<input
				id={props.id ?? `field-${props.name}`}
				type="checkbox"
				className={`${compact ? "mt-0.5 size-4" : "mt-1 size-5.5"} shrink-0 accent-primary`}
				{...props}
			/>
			{label}
		</label>
	);
}
