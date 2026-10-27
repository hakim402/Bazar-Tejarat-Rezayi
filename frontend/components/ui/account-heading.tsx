import type { ReactNode } from "react";
export function AccountHeading({
	children,
	compact = false,
}: {
	children: ReactNode;
	compact?: boolean;
}) {
	return (
		<h1
			tabIndex={-1}
			className={
				compact
					? "mb-3 max-w-full text-xl leading-snug font-bold"
					: "mb-6 max-w-full text-account-title desktop:text-account-title-desktop"
			}
		>
			{children}
		</h1>
	);
}
