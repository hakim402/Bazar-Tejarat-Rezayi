"use client";
export function SkipLink({ label }: { label: string }) {
	return (
		// biome-ignore lint/a11y/useValidAnchor: This skip link retains a real fragment destination and explicitly focuses its landmark.
		<a
			href="#main"
			className="skip-link"
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
