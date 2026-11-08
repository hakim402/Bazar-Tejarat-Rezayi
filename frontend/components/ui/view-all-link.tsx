import Link from "next/link";
import { Icon } from "./icon";

export function ViewAllLink({ href, label }: { href: string; label: string }) {
	return (
		<Link
			href={href}
			className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-sm font-medium text-action no-underline hover:underline"
		>
			{label}
			<Icon name="chevron" className="size-4" />
		</Link>
	);
}
