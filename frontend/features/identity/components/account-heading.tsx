import type { ReactNode } from "react";
export function AccountHeading({ children }: { children: ReactNode }) {
	return (
		<h1 className="mb-5 max-w-full text-account-title desktop:text-account-title-desktop">
			{children}
		</h1>
	);
}
