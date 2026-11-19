"use client";

import type * as React from "react";
import { cn } from "@/lib/shadcn-utils";
import { Switch as SwitchPrimitive } from "radix-ui";

function Switch({
	className,
	...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer appearance-none items-center rounded-full border border-solid border-control bg-control shadow-xs transition-colors outline-none focus-visible:border-action focus-visible:ring-[3px] focus-visible:ring-action/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none absolute top-0.5 start-0.5 block size-4.5 rounded-full bg-surface ring-0 transition-[inset-inline-start] duration-150 data-[state=checked]:start-5.5 motion-reduce:transition-none"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };