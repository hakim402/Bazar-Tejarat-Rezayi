import { EmptyState } from "./empty-state";

export interface SellerMessagePreview {
	id: string;
	sender: string;
	preview: string;
	/** ISO timestamp. */
	at: string;
	unread: boolean;
}

function initials(name: string) {
	const parts = name.trim().split(/\s+/).slice(0, 2);
	return parts.map((part) => Array.from(part)[0] ?? "").join("");
}

export function RecentMessagesList({
	messages,
	locale,
	unreadLabel,
	emptyTitle,
	emptyDescription,
}: {
	messages: SellerMessagePreview[];
	locale: string;
	unreadLabel: string;
	emptyTitle: string;
	emptyDescription: string;
}) {
	if (!messages.length)
		return (
			<EmptyState
				borderless
				icon="mail"
				title={emptyTitle}
				description={emptyDescription}
			/>
		);

	const day = new Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
		timeZone: "Asia/Kabul",
	});

	return (
		<ul className="min-w-0 list-none p-0">
			{messages.map((message) => (
				<li
					key={message.id}
					className="flex items-start gap-3 border-b border-border py-3 last:border-0"
				>
					<span
						aria-hidden="true"
						className="flex size-10 shrink-0 items-center justify-center rounded-full bg-chip-neutral-bg text-sm font-semibold text-chip-neutral"
					>
						{initials(message.sender)}
					</span>
					<span className="min-w-0 flex-1">
						<span className="flex items-baseline justify-between gap-2">
							<span
								className={`min-w-0 truncate ${message.unread ? "font-semibold" : "font-medium"} text-foreground`}
							>
								{message.sender}
							</span>
							<time
								dateTime={message.at}
								className="shrink-0 text-xs text-muted"
							>
								{day.format(new Date(message.at))}
							</time>
						</span>
						<span className="mt-0.5 flex min-w-0 items-center gap-1.5">
							{message.unread && (
								<>
									<span
										aria-hidden="true"
										className="size-2 shrink-0 rounded-full bg-action"
									/>
									<span className="sr-only">{unreadLabel}</span>
								</>
							)}
							<span className="min-w-0 truncate text-sm text-muted">
								{message.preview}
							</span>
						</span>
					</span>
				</li>
			))}
		</ul>
	);
}
