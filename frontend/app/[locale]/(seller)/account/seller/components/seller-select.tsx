"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "../../../../../../components/ui/icon";

export function SellerSelect({
	label,
	value,
	options,
	onChange,
	icon,
	compact = false,
	side = "bottom",
	id,
}: {
	label: string;
	value: string;
	options: readonly { value: string; label: string; lang?: string }[];
	onChange: (value: string) => void;
	icon?: IconName;
	compact?: boolean;
	side?: "top" | "bottom";
	id?: string;
}) {
	const generatedId = useId();
	const triggerId = id ?? generatedId;
	const listId = `${triggerId}-options`;
	const root = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLButtonElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const search = useRef({ text: "", at: 0 });
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const selected = options.findIndex((option) => option.value === value);
	const current = options[selected];

	useEffect(() => {
		if (!open) return;
		const dismiss = (event: Event) => {
			if (event.target instanceof Node && !root.current?.contains(event.target))
				setOpen(false);
		};
		document.addEventListener("pointerdown", dismiss);
		document.addEventListener("focusin", dismiss);
		return () => {
			document.removeEventListener("pointerdown", dismiss);
			document.removeEventListener("focusin", dismiss);
		};
	}, [open]);

	useEffect(() => {
		if (open)
			list.current?.children[active]?.scrollIntoView({ block: "nearest" });
	}, [active, open]);

	const choose = (index: number) => {
		const option = options[index];
		if (!option) return;
		setOpen(false);
		trigger.current?.focus();
		if (option.value !== value) onChange(option.value);
	};
	const show = (index = Math.max(0, selected)) => {
		setActive(index);
		setOpen(true);
	};
	const handleKey = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "Tab") {
			setOpen(false);
			return;
		}
		if (event.key === "Escape" && open) {
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
			return;
		}
		if (!options.length) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (!open) show();
			else
				setActive(
					(index) =>
						(event.key === "ArrowDown"
							? index + 1
							: index - 1 + options.length) % options.length,
				);
		} else if (event.key === "Home" || event.key === "End") {
			event.preventDefault();
			show(event.key === "Home" ? 0 : options.length - 1);
		} else if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			if (open) choose(active);
			else show();
		} else if (
			event.key.length === 1 &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey
		) {
			event.preventDefault();
			const now = Date.now();
			const text =
				(now - search.current.at < 700 ? search.current.text : "") + event.key;
			search.current = { text, at: now };
			const index = options.findIndex((option) =>
				option.label
					.toLocaleLowerCase(option.lang)
					.startsWith(text.toLocaleLowerCase(option.lang)),
			);
			if (index >= 0) show(index);
		}
	};

	return (
		<div ref={root} className="relative min-w-0">
			<button
				ref={trigger}
				id={triggerId}
				type="button"
				disabled={!options.length}
				role="combobox"
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				aria-activedescendant={
					open && options[active] ? `${listId}-${active}` : undefined
				}
				onClick={() => (open ? setOpen(false) : show())}
				onKeyDown={handleKey}
				className={`flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-action hover:bg-info disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none ${compact ? "justify-center" : "text-start"}`}
			>
				{icon && <Icon name={icon} className="size-4 text-muted" />}
				<span className="min-w-0 flex-1 truncate">
					<bdi>{current?.label ?? label}</bdi>
				</span>
				<Icon
					name="chevron-down"
					className={`size-3.5 text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
				/>
			</button>
			{open && (
				<div
					ref={list}
					id={listId}
					role="listbox"
					aria-label={label}
					className={`absolute end-0 z-50 max-h-60 w-max min-w-full max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lifted ${side === "top" ? "bottom-full mb-2" : "top-full mt-2"}`}
				>
					{options.map((option, index) => (
						<button
							key={option.value}
							id={`${listId}-${index}`}
							type="button"
							value={option.value}
							role="option"
							aria-selected={option.value === value}
							tabIndex={-1}
							lang={option.lang}
							onPointerDown={(event) => event.preventDefault()}
							onPointerMove={() => setActive(index)}
							onClick={() => choose(index)}
							className={`flex min-h-11 w-full cursor-pointer items-center justify-between gap-5 rounded-lg border-0 px-3 py-2 text-start text-sm ${index === active ? "bg-info text-action" : "bg-transparent text-foreground"}`}
						>
							<bdi className="min-w-0 whitespace-normal">{option.label}</bdi>
							{option.value === value && (
								<Icon name="check" className="size-4" />
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
