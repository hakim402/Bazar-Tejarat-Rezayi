"use client";
import Link from "next/link";
import {
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "../../../components/shadcn/alert-dialog";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import { Icon, type IconName } from "../../../components/ui/icon";
import { direction, type Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import { orderDetailCopy } from "../detail-copy";
import { organizationCopy } from "../../../lib/i18n/organizations";
import { authCopy } from "../../../lib/i18n/auth";
import {
	formActionsClass,
	formControlSizes,
} from "../../../components/ui/dialog-form";

// Secondary order detail opens on demand so the primary view stays scannable.
// Content mounts only while open, so embedded workspaces do not poll in the
// background; keepMounted retains draft-bearing forms across close.
// Reuses the native <dialog> pattern already used by the buyer
// drawer: modal focus, Escape, backdrop click and focus return.
export function DetailDialog({
	locale,
	title,
	icon,
	label,
	badge,
	description,
	wide = false,
	keepMounted = false,
	inline = false,
	footer,
	open: openProp,
	onOpenChange,
	onTrigger,
	trigger,
	triggerVariant = "secondary",
	triggerSize = "sm",
	children,
}: {
	locale: Locale;
	title: string;
	icon?: IconName;
	label: string;
	badge?: ReactNode;
	description?: ReactNode;
	wide?: boolean;
	keepMounted?: boolean;
	inline?: boolean;
	footer?: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	onTrigger?: () => void;
	trigger?: ReactNode;
	triggerVariant?: "default" | "secondary" | "outline" | "ghost";
	triggerSize?: "sm" | "default";
	children: ReactNode;
}) {
	const dialog = useRef<HTMLDialogElement>(null),
		triggerButton = useRef<HTMLButtonElement>(null),
		triggerWrap = useRef<HTMLSpanElement>(null),
		closeButton = useRef<HTMLButtonElement>(null),
		[internalOpen, setInternalOpen] = useState(false),
		[mounted, setMounted] = useState(false),
		titleId = useId(),
		close = orderDetailCopy[locale].close;
	const controlled = openProp !== undefined,
		open = controlled ? openProp : internalOpen;
	function setOpen(next: boolean) {
		if (controlled) onOpenChange?.(next);
		else setInternalOpen(next);
	}
	useEffect(() => setMounted(true), []);
	useEffect(() => {
		if (!mounted) return;
		const node = dialog.current;
		if (!node) return;
		if (open && !node.open) {
			node.showModal();
			closeButton.current?.focus();
		}
		if (!open && node.open) node.close();
	}, [open, mounted]);
	return (
		<>
			{trigger ? (
				<span ref={triggerWrap} className="contents">
					{trigger}
				</span>
			) : (
				<Button
					ref={triggerButton}
					type="button"
					variant={triggerVariant}
					size={triggerSize}
					aria-haspopup="dialog"
					onClick={() => (onTrigger ? onTrigger() : setOpen(true))}
					className={cn("max-w-full gap-2 rounded-lg", !inline && "self-start")}
				>
					<span className="inline-flex min-w-0 items-center gap-2">
						{icon && <Icon name={icon} className="size-3.5 shrink-0" />}
						<span className="truncate">{label}</span>
						{badge}
					</span>
					{!inline && (
						<Icon name="chevron" className="size-3.5 shrink-0 text-action/70" />
					)}
				</Button>
			)}
			{mounted &&
				createPortal(
					// biome-ignore lint/a11y/useKeyWithClickEvents: the native modal dialog owns Escape (onCancel) and focus trapping; onClick only dismisses on backdrop pointer clicks.
					<dialog
						ref={dialog}
						dir={direction(locale)}
						aria-labelledby={titleId}
						onCancel={(event) => {
							event.preventDefault();
							setOpen(false);
						}}
						onClose={() => {
							setOpen(false);
							const node =
								triggerButton.current ??
								triggerWrap.current?.querySelector<HTMLElement>(
									"button, a[href], [tabindex]",
								);
							if (node?.getClientRects().length) node.focus();
						}}
						onClick={(event) => {
							if (event.target !== event.currentTarget) return;
							const rect = event.currentTarget.getBoundingClientRect();
							if (
								event.clientX < rect.left ||
								event.clientX > rect.right ||
								event.clientY < rect.top ||
								event.clientY > rect.bottom
							)
								setOpen(false);
						}}
						className={cn(
							"fixed inset-0 m-auto h-fit max-h-[85dvh] flex-col overflow-hidden rounded-card border border-border bg-surface p-0 text-foreground shadow-lifted backdrop:bg-overlay motion-safe:animate-[dialog-in_160ms_ease-out]",
							formControlSizes,
							"[&_p]:wrap-anywhere",
							wide
								? "w-[min(52rem,calc(100vw-2rem))]"
								: "w-[min(38rem,calc(100vw-2rem))]",
							open ? "flex" : "hidden",
						)}
					>
						<header className="flex shrink-0 items-start justify-between gap-3 border-0 border-b border-solid border-border px-4 py-3">
							<div className="flex min-w-0 items-start gap-2.5">
								{icon && (
									<Icon name={icon} className="mt-0.5 size-5 shrink-0" />
								)}
								<div className="min-w-0">
									<h2
										id={titleId}
										className="m-0 truncate text-base font-semibold"
									>
										{title}
									</h2>
									{description && (
										<p
											dir="auto"
											className="m-0 mt-0.5 text-xs leading-5 text-muted"
										>
											{description}
										</p>
									)}
								</div>
							</div>
							<button
								ref={closeButton}
								type="button"
								aria-label={close}
								title={close}
								onClick={() => setOpen(false)}
								className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-muted transition-colors hover:bg-info hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none"
							>
								<Icon name="close" className="size-4" />
							</button>
						</header>
						<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-color:var(--line)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb:hover]:bg-muted [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
							{open || keepMounted ? children : null}
						</div>
						{footer && (
							<footer
								className={cn(
									formActionsClass,
									"shrink-0 border-0 border-t border-solid border-border px-4 py-3",
								)}
							>
								{footer}
							</footer>
						)}
					</dialog>,
					document.body,
				)}
		</>
	);
}

// shadcn confirmation portalled into the topmost open native <dialog> (when
// one is open) so it stacks above modal workspaces instead of rendering behind
// the native top layer. The confirm action is a plain Button: an in-flight busy
// state must keep the dialog open until the owner clears it.
export function ConfirmDialog({
	locale,
	open,
	title,
	body,
	confirmLabel,
	destructive = false,
	busy,
	onCancel,
	onConfirm,
}: {
	locale: Locale;
	open: boolean;
	title: string;
	body: string;
	confirmLabel: string;
	destructive?: boolean;
	busy: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const [container, setContainer] = useState<Element | null>(null);
	useLayoutEffect(() => {
		if (!open) return;
		const nodes = document.querySelectorAll("dialog[open]");
		setContainer(nodes[nodes.length - 1] ?? null);
	}, [open]);
	return (
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onCancel();
			}}
		>
			<AlertDialogContent
				container={container}
				dir={direction(locale)}
				onEscapeKeyDown={(event) => {
					event.preventDefault();
					if (!busy) onCancel();
				}}
				className="max-w-md gap-5 rounded-2xl p-6"
			>
				<AlertDialogHeader className="gap-3 text-start">
					<span
						className={cn(
							"flex size-11 items-center justify-center rounded-xl",
							destructive
								? "bg-danger-surface text-danger"
								: "bg-info text-action",
						)}
					>
						<Icon
							name={destructive ? "alert-triangle" : "help"}
							className="size-5"
						/>
					</span>
					<AlertDialogTitle className="text-base font-semibold">
						{title}
					</AlertDialogTitle>
					<AlertDialogDescription className="leading-6">
						{body}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="gap-3">
					<AlertDialogCancel disabled={busy}>
						{organizationCopy[locale].cancel}
					</AlertDialogCancel>
					<Button
						type="button"
						variant={destructive ? "destructive" : "default"}
						onClick={onConfirm}
						disabled={busy}
					>
						{busy ? authCopy[locale].saving : confirmLabel}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function DialogLink({
	href,
	icon,
	children,
}: {
	href: string;
	icon?: IconName;
	children: ReactNode;
}) {
	return (
		<Button asChild variant="secondary" size="sm" className="rounded-lg">
			<Link href={href} prefetch={false}>
				{icon && <Icon name={icon} className="size-3.5" />}
				{children}
			</Link>
		</Button>
	);
}

export function DialogBadge({
	variant,
	children,
}: {
	variant: "warning" | "danger";
	children: ReactNode;
}) {
	return (
		<Badge
			variant="secondary"
			className={cn(
				"border-0",
				variant === "warning"
					? "bg-warning-surface text-warning"
					: "bg-danger-surface text-danger",
			)}
		>
			{children}
		</Badge>
	);
}
