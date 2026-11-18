"use client";
import { usePathname } from "next/navigation";
import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
} from "react";
import { Icon, type IconName } from "../ui/icon";

export function CountPill({ count }: { count: number }) {
	return (
		<span
			aria-hidden="true"
			className="grid h-[1.125rem] min-w-[1.125rem] shrink-0 place-items-center rounded-full bg-primary px-1 text-[0.625rem] font-bold leading-none text-on-primary"
		>
			<bdi>{count > 99 ? "99+" : count}</bdi>
		</span>
	);
}

export function HeaderBadge({ count }: { count: number }) {
	if (count <= 0) return null;
	return (
		<span className="absolute -end-0.5 -top-0.5 rounded-full ring-2 ring-surface">
			<CountPill count={count} />
		</span>
	);
}

/** Shared header dropdown: animated Tailwind panel, badge, keyboard support.
 * On narrow screens the panel becomes a fixed sheet measured below the trigger
 * so it never overflows the viewport; on wider screens it anchors to the icon. */
export function HeaderMenu({
	icon,
	label,
	count = 0,
	className = "",
	triggerClassName = "",
	triggerContent,
	panelClassName = "",
	panelLabel,
	onOpen,
	onClose,
	children,
}: {
	icon: IconName;
	label: string;
	count?: number;
	className?: string;
	triggerClassName?: string;
	triggerContent?: ReactNode;
	panelClassName?: string;
	panelLabel: string;
	onOpen?: () => void;
	onClose?: () => void;
	children: (close: (restoreFocus?: boolean) => void) => ReactNode;
}) {
	const path = usePathname();
	const [open, setOpen] = useState(false);
	const [rendered, setRendered] = useState(false);
	const [visible, setVisible] = useState(false);
	const [anchor, setAnchor] = useState(0);
	const [space, setSpace] = useState(320);
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const panel = useRef<HTMLElement>(null);
	const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const enterFrame = useRef<number | null>(null);
	const pendingFocus = useRef<"first" | "last" | null>(null);
	const lastPath = useRef(path);
	const handlers = useRef({ onOpen, onClose });
	handlers.current = { onOpen, onClose };
	const panelId = useId();

	const clearTimers = useCallback(() => {
		if (exitTimer.current !== null) {
			clearTimeout(exitTimer.current);
			exitTimer.current = null;
		}
		if (enterFrame.current !== null) {
			cancelAnimationFrame(enterFrame.current);
			enterFrame.current = null;
		}
	}, []);

	const close = useCallback(
		(restoreFocus = false) => {
			clearTimers();
			pendingFocus.current = null;
			setOpen(false);
			setVisible(false);
			exitTimer.current = setTimeout(() => {
				exitTimer.current = null;
				setRendered(false);
			}, 200);
			if (restoreFocus) trigger.current?.focus();
			handlers.current.onClose?.();
		},
		[clearTimers],
	);

	const show = useCallback(() => {
		clearTimers();
		const top = (trigger.current?.getBoundingClientRect().bottom ?? 0) + 8;
		setAnchor(top);
		// Keep clearance for mobile bottom navigation and the viewport edge.
		setSpace(Math.max(160, window.innerHeight - top - 80));
		setRendered(true);
		setOpen(true);
		enterFrame.current = requestAnimationFrame(() => {
			enterFrame.current = requestAnimationFrame(() => {
				enterFrame.current = null;
				setVisible(true);
			});
		});
		handlers.current.onOpen?.();
	}, [clearTimers]);

	useEffect(() => clearTimers, [clearTimers]);

	useEffect(() => {
		if (lastPath.current === path) return;
		lastPath.current = path;
		close();
	}, [path, close]);

	useEffect(() => {
		if (!open) return;
		const outside = (event: Event) => {
			if (event.target instanceof Node && !root.current?.contains(event.target))
				close();
		};
		const closeOnEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			close(true);
		};
		document.addEventListener("pointerdown", outside);
		document.addEventListener("focusin", outside);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", outside);
			document.removeEventListener("focusin", outside);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [open, close]);

	const focusables = () =>
		Array.from(
			panel.current?.querySelectorAll<HTMLElement>(
				"a[href], button:not(:disabled)",
			) ?? [],
		).filter((item) => item.getClientRects().length > 0);

	useEffect(() => {
		if (!open || !pendingFocus.current) return;
		const items = focusables();
		if (!items.length) return;
		items[pendingFocus.current === "last" ? items.length - 1 : 0]?.focus();
		pendingFocus.current = null;
	});

	const arrows = (event: KeyboardEvent<HTMLElement>) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const last = event.key === "ArrowUp";
		if (!open) {
			pendingFocus.current = last ? "last" : "first";
			show();
			return;
		}
		const items = focusables();
		if (!items.length) return;
		const index =
			document.activeElement instanceof HTMLElement
				? items.indexOf(document.activeElement)
				: -1;
		const next =
			index < 0
				? last
					? items.length - 1
					: 0
				: (index + (last ? -1 : 1) + items.length) % items.length;
		items[next]?.focus();
	};

	return (
		<div ref={root} className={`relative shrink-0 ${className}`}>
			<button
				ref={trigger}
				type="button"
				aria-label={count > 0 ? `${label} (${count})` : label}
				title={label}
				aria-expanded={open}
				aria-controls={rendered ? panelId : undefined}
				onClick={() => (open ? close() : show())}
				onKeyDown={arrows}
				className={`relative flex shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent transition-colors hover:bg-info aria-[expanded=true]:bg-info aria-[expanded=true]:text-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none ${triggerClassName}`}
			>
				{triggerContent ?? <Icon name={icon} />}
				<HeaderBadge count={count} />
			</button>
			{rendered && (
				<section
					ref={panel}
					id={panelId}
					aria-label={panelLabel}
					onKeyDown={arrows}
					style={
						{
							"--header-anchor": `${anchor}px`,
							"--header-space": `${space}px`,
						} as CSSProperties
					}
					className={`absolute end-0 top-full z-50 mt-2 origin-top rounded-card border border-border bg-surface text-start text-foreground shadow-lifted transition duration-200 ease-out motion-reduce:transition-none max-[767px]:fixed max-[767px]:inset-x-3 max-[767px]:top-[var(--header-anchor)] max-[767px]:mt-0 max-[767px]:w-auto max-[767px]:max-h-[var(--header-space)] ${
						visible
							? "translate-y-0 scale-100 opacity-100"
							: "pointer-events-none -translate-y-1 scale-[0.98] opacity-0"
					} ${panelClassName}`}
				>
					{children(close)}
				</section>
			)}
		</div>
	);
}
