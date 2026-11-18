import type { Locale } from "../../lib/i18n/locales";
import type { ProfileIdentity } from "../../features/identity/api/profile";
import { mediaUrl } from "../../features/marketplace/api";
import { Icon } from "./icon";

// Shared account circle for buyer/seller dashboards and the public header:
// uploaded avatar, else initials, else a neutral icon.
export function AccountAvatar({
	identity,
	locale,
	className = "size-9 bg-info text-caption text-action",
}: {
	identity?: ProfileIdentity | null;
	locale: Locale;
	className?: string;
}) {
	const avatar = identity?.avatar ? mediaUrl(identity.avatar.url) : null;
	const name = identity?.display_name.trim() ?? "";
	const parts = name.split(/\s+/);
	const initials = name
		? (parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts)
				.map((part) => Array.from(part)[0])
				.join("")
				.toLocaleUpperCase(locale)
		: Array.from(identity?.email ?? "")[0]?.toLocaleUpperCase(locale);
	return (
		<span
			aria-hidden="true"
			className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold ${className}`}
		>
			{avatar ? (
				// biome-ignore lint/performance/noImgElement: private avatar bytes are served with credentials; next/image cannot optimize them.
				<img src={avatar} alt="" className="size-full object-cover" />
			) : initials ? (
				<bdi>{initials}</bdi>
			) : (
				<Icon name="user-circle" className="size-[60%]" />
			)}
		</span>
	);
}
