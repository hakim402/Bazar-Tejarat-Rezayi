import { cloneElement, isValidElement, type ReactNode } from "react";
import { Input } from "../shadcn/input";
import { Textarea } from "../shadcn/textarea";
import { cn } from "../../lib/shadcn-utils";
import { Icon } from "./icon";

// Shared dialog-form field: label above the control, required marker,
// inline validity badge and help/error text, per the owner's form mockup.
export function FormField({
	id,
	label,
	required,
	optional,
	error,
	help,
	valid,
	trailing,
	children,
}: {
	id: string;
	label: string;
	required?: boolean;
	optional?: string;
	error?: string;
	help?: string;
	valid?: boolean;
	trailing?: ReactNode;
	children: ReactNode;
}) {
	const control = isValidElement<{
		value?: unknown;
		defaultValue?: unknown;
		className?: string;
	}>(children)
		? children
		: null;
	const multiline = control?.type === Textarea;
	const textual = control?.type === Input || multiline;
	const raw = control?.props.value ?? control?.props.defaultValue;
	const filled = typeof raw === "string" && raw.trim() !== "";
	const showValid = textual && !error && (valid ?? filled);
	const pad =
		showValid && trailing ? "pe-16" : showValid || trailing ? "pe-9" : "";
	return (
		<div className="min-w-0 space-y-1.5">
			<label htmlFor={id} className="block text-sm font-medium text-foreground">
				{label}
				{required && (
					<span className="text-danger" aria-hidden="true">
						{" "}
						*
					</span>
				)}
				{optional && (
					<span className="font-normal text-muted"> ({optional})</span>
				)}
			</label>
			<div className="relative">
				{control && pad
					? cloneElement(control, {
							className: cn(control.props.className, pad),
						})
					: children}
				{showValid && (
					<span
						aria-hidden="true"
						className={cn(
							"pointer-events-none absolute flex size-5 items-center justify-center rounded-full bg-success text-white",
							trailing && !multiline ? "end-10" : "end-2.5",
							multiline ? "top-2.5" : "top-1/2 -translate-y-1/2",
						)}
					>
						<Icon name="check" className="size-3" />
					</span>
				)}
				{trailing && !multiline && (
					<span className="absolute end-1.5 top-1/2 -translate-y-1/2">
						{trailing}
					</span>
				)}
			</div>
			{help && !error && (
				<p id={`${id}-help`} className="m-0 text-xs text-muted">
					{help}
				</p>
			)}
			{error && (
				<p id={`${id}-error`} role="alert" className="m-0 text-xs text-danger">
					{error}
				</p>
			)}
		</div>
	);
}

// Mockup footer: equal-width action pair, single action spans the row.
export const formActionsClass =
	"grid gap-3 sm:grid-cols-2 [&>*:only-child]:sm:col-span-2 [&>*]:h-11! [&>*]:w-full! [&>*]:rounded-lg!";

export function FormActions({ children }: { children: ReactNode }) {
	return <div className={formActionsClass}>{children}</div>;
}

// Control rounding and label sizing shared by dashboard frames and portalled
// dialogs; the shadcn primitives own the compact heights and type sizes.
export const formControlSizes =
	"[&_label]:text-sm [&_label]:font-medium [&_input:not([type=checkbox]):not([type=radio])]:rounded-control [&_textarea]:rounded-control [&_select]:rounded-control [&_fieldset]:min-w-0";
