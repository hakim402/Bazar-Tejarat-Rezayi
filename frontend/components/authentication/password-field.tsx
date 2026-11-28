"use client";
import { useState, type ComponentProps } from "react";
import { Input } from "../shadcn/input";
import { Button } from "../shadcn/button";
import { Icon } from "../ui/icon";
import { cn } from "@/lib/shadcn-utils";
import { FormField } from "../ui/dialog-form";

export function PasswordField({
	label,
	help,
	error,
	showLabel,
	hideLabel,
	className,
	...props
}: ComponentProps<typeof Input> & {
	id: string;
	label: string;
	help?: string;
	error?: string;
	showLabel: string;
	hideLabel: string;
}) {
	const [revealed, setRevealed] = useState(false);
	return (
		<FormField
			id={props.id}
			label={label}
			required
			help={help}
			error={error}
			trailing={
				<Button
					type="button"
					variant="ghost"
					size="icon"
					disabled={props.disabled}
					aria-label={revealed ? hideLabel : showLabel}
					aria-pressed={revealed}
					onClick={() => setRevealed(!revealed)}
					className="size-9"
				>
					<Icon name="eye" className="size-4" />
				</Button>
			}
		>
			<Input
				{...props}
				type={revealed ? "text" : "password"}
				dir="ltr"
				maxLength={128}
				className={cn("min-h-11 text-base", className)}
				aria-invalid={!!error}
				aria-describedby={
					error ? `${props.id}-error` : help ? `${props.id}-help` : undefined
				}
			/>
		</FormField>
	);
}
