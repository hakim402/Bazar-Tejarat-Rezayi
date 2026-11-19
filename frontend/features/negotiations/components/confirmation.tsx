"use client";
import { useRef, type ReactNode } from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { Icon } from "../../../components/ui/icon";
import { cn } from "../../../lib/shadcn-utils";
import { panel } from "../../orders/components/controls";

// Shared confirm shell for the exact-review flows (deliveries, aftercare,
// payments, negotiation finalize). Mounted only while open; the parent owns
// the busy guard inside `close`. Radix supplies the modal focus trap, Escape
// and focus return that the previous native <dialog> hand-rolled.
export function Confirmation({
	label,
	close,
	children,
	returnFocus,
	presentation,
	closeLabel,
}: {
	label: string;
	close: () => void;
	children: ReactNode;
	returnFocus: HTMLElement | null;
	presentation?: "buyer";
	closeLabel?: string;
}) {
	const onClose = useRef(close);
	onClose.current = close;
	const buyer = presentation === "buyer";
	return (
		<AlertDialogPrimitive.Root
			open
			onOpenChange={(next) => {
				if (!next) onClose.current();
			}}
		>
			<AlertDialogPrimitive.Portal>
				<AlertDialogPrimitive.Overlay
					className={cn("fixed inset-0 z-50", buyer ? "bg-overlay" : "bg-black/50")}
				/>
				<AlertDialogPrimitive.Content
					onCloseAutoFocus={(event) => {
						if (returnFocus) {
							event.preventDefault();
							if (returnFocus.isConnected) returnFocus.focus();
						}
					}}
					className={cn(
						"fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 text-foreground",
						buyer
							? "flex max-h-[90dvh] w-[min(38rem,calc(100%-2rem))] flex-col overflow-hidden rounded-card border border-border bg-surface p-0 shadow-lifted"
							: cn(
									panel,
									"block max-h-[90dvh] w-[min(36rem,calc(100%-2rem))] overflow-y-auto",
								),
					)}
				>
					{buyer ? (
						<>
							<header className="flex shrink-0 items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-3">
								<AlertDialogPrimitive.Title className="m-0 text-sm font-semibold">
									{label}
								</AlertDialogPrimitive.Title>
								<button
									type="button"
									aria-label={closeLabel}
									title={closeLabel}
									onClick={() => onClose.current()}
									className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:border-action hover:bg-info hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none"
								>
									<Icon name="close" className="size-4" />
								</button>
							</header>
							<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
								{children}
							</div>
						</>
					) : (
						<>
							{children}
							<AlertDialogPrimitive.Title className="sr-only">
								{label}
							</AlertDialogPrimitive.Title>
						</>
					)}
				</AlertDialogPrimitive.Content>
			</AlertDialogPrimitive.Portal>
		</AlertDialogPrimitive.Root>
	);
}