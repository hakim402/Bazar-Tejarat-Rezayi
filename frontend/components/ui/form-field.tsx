import type { ComponentProps, ReactNode } from "react";
export const inputClass =
	"w-full min-w-0 min-h-13.5 rounded-control border border-control bg-surface text-foreground px-3.5 py-2.5 font-normal";
export function Input({ className = "", ...props }: ComponentProps<"input">) {
	return (
		<input
			id={props.id ?? `field-${props.name}`}
			className={`${inputClass} ${props.dir === "ltr" ? "font-identifier" : ""} ${className}`}
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
	name,
	label,
	children,
}: {
	name: string;
	label: ReactNode;
	children: ReactNode;
}) {
	return (
		<label
			htmlFor={`field-${name}`}
			className="account-field my-2 flex flex-col gap-2 font-bold"
		>
			{label}
			{children}
		</label>
	);
}
export function CheckField({
	label,
	...props
}: ComponentProps<"input"> & { label: ReactNode }) {
	return (
		<label className="account-check flex cursor-pointer items-start gap-3 py-3 text-base leading-relaxed">
			<input
				id={props.id ?? `field-${props.name}`}
				type="checkbox"
				className="mt-1 size-5.5 shrink-0 accent-primary"
				{...props}
			/>
			{label}
		</label>
	);
}
