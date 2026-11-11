import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/shadcn-utils";
import { Slot } from "radix-ui";

const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-action focus-visible:ring-[3px] focus-visible:ring-action/50 aria-invalid:border-danger aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40 [&>svg]:pointer-events-none [&>svg]:size-3",
	{
		variants: {
			variant: {
				default: "bg-primary text-on-primary [a&]:hover:bg-primary/90",
				secondary: "bg-info text-action [a&]:hover:bg-info/90",
				destructive:
					"bg-danger text-white focus-visible:ring-danger/20 dark:bg-danger/60 dark:focus-visible:ring-danger/40 [a&]:hover:bg-danger/90",
				outline:
					"border-border text-foreground [a&]:hover:bg-info [a&]:hover:text-foreground",
				ghost: "[a&]:hover:bg-info [a&]:hover:text-foreground",
				link: "text-primary underline-offset-4 [a&]:hover:underline",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant = "default",
	asChild = false,
	...props
}: React.ComponentProps<"span"> &
	VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "span";

	return (
		<Comp
			data-slot="badge"
			data-variant={variant}
			className={cn(badgeVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
