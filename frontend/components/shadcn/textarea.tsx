import type * as React from "react";
import { cn } from "@/lib/shadcn-utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"flex field-sizing-content min-h-16 w-full rounded-md border border-solid border-control bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted focus-visible:border-action focus-visible:ring-[3px] focus-visible:ring-action/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20 md:text-sm dark:bg-info/30 dark:aria-invalid:ring-danger/40",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
