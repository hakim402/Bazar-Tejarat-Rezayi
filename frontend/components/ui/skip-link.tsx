"use client";
export function SkipLink({ label }: { label: string }) {
	return (
		// biome-ignore lint/a11y/useValidAnchor: This skip link retains a real fragment destination and explicitly focuses its landmark.
		<a
			href="#main"
			className="skip-link fixed -top-40 start-4 z-50 rounded-control border border-action bg-surface px-5 py-3 font-bold focus:top-3"
			onClick={(event) => {
				const main = document.getElementById("main");
				if (main) {
					event.preventDefault();
					main.focus();
					main.scrollIntoView({ block: "start" });
				}
			}}
		>
			{label}
		</a>
	);
}
