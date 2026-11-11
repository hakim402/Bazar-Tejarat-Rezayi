import type { ComponentProps, ReactNode } from "react";
import { Button as ShadcnButton } from "../../../components/shadcn/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../../components/shadcn/card";
import { cn } from "../../../lib/shadcn-utils";

export function Button({
	variant = "primary",
	compact = false,
	className,
	...props
}: Omit<ComponentProps<typeof ShadcnButton>, "variant" | "size"> & {
	variant?: "primary" | "secondary" | "compact";
	compact?: boolean;
}) {
	return (
		<ShadcnButton
			type="button"
			variant={variant === "secondary" ? "outline" : "default"}
			size={compact || variant === "compact" ? "sm" : "lg"}
			className={cn("rounded-xl font-semibold shadow-none", className)}
			{...props}
		/>
	);
}
export function ProductSection({
	title,
	description,
	icon,
	children,
	className,
	...props
}: Omit<ComponentProps<"div">, "title"> & {
	title?: string;
	description?: string;
	icon?: ReactNode;
}) {
	return (
		<Card
			className={cn(
				"gap-5 rounded-2xl border-border bg-surface py-5 shadow-xs sm:py-6",
				className,
			)}
			{...props}
		>
			{title && (
				<CardHeader className="gap-1.5 px-5 sm:px-6">
					<CardTitle className="flex items-center gap-2 text-base font-semibold">
						{icon}
						{title}
					</CardTitle>
					{description && (
						<CardDescription className="text-xs leading-relaxed text-muted">
							{description}
						</CardDescription>
					)}
				</CardHeader>
			)}
			<CardContent className="min-w-0 px-5 sm:px-6">{children}</CardContent>
		</Card>
	);
}
