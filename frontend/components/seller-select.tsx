"use client";

import { useId } from "react";
import { Icon, type IconName } from "./ui/icon";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./shadcn/select";

// Radix reserves "" for the placeholder, so a selectable "all/none" option
// (value "") maps to a sentinel that cannot collide with real ids/states.
const EMPTY = "__seller_select_empty__";

export function SellerSelect({
	label,
	value,
	options,
	onChange,
	icon,
	id,
	dir,
}: {
	label: string;
	value: string;
	options: readonly { value: string; label: string; lang?: string }[];
	onChange: (value: string) => void;
	icon?: IconName;
	id?: string;
	dir?: "ltr" | "rtl";
}) {
	const generatedId = useId();
	const triggerId = id ?? generatedId;
	const selected = options.find((option) => option.value === value);
	const current = selected ? (selected.value === "" ? EMPTY : value) : "";
	return (
		<Select
			dir={dir}
			value={current}
			onValueChange={(next) => onChange(next === EMPTY ? "" : next)}
			disabled={!options.length}
		>
			<SelectTrigger
				id={triggerId}
				aria-label={label}
				className="min-h-11 w-full cursor-pointer gap-2 rounded-xl border-border bg-surface px-3 text-sm font-medium text-foreground shadow-sm hover:border-action hover:bg-info motion-reduce:transition-none dark:bg-surface [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:text-start"
			>
				{icon && <Icon name={icon} className="size-4 text-muted" />}
				<SelectValue placeholder={label} />
			</SelectTrigger>
			<SelectContent aria-label={label}>
				{options.map((option) => (
					<SelectItem
						key={option.value}
						value={option.value === "" ? EMPTY : option.value}
						textValue={option.label}
						lang={option.lang}
						className="min-h-11"
					>
						<bdi>{option.label}</bdi>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
