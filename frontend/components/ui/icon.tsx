import type { ComponentProps } from "react";
const paths = {
	bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
	heart: "M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-4 5 3 10 8 15 5-5 12-10 8-15Z",
	cart: "M2 3h3l3 13h11l3-9H6 M10 21h.01 M18 21h.01",
	globe:
		"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18",
	dress: "m8 3 4 2 4-2 3 5-4 3 5 10H4l5-10-4-3Z",
	leaf: "M20 3C7 2 2 7 5 15c8 4 15-2 15-12Z M4 21 15 9",
	beauty: "M8 10h8v11H8Z M10 10V4l4-2v8 M8 16h8",
	chair: "M6 11V7a6 6 0 0 1 12 0v4 M4 11h3v6h10v-6h3v8H4Z M6 19v3 M18 19v3",
	phone: "M7 3h10v18H7Z M11 18h2",
	sparkle: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
	mail: "M3 5h18v14H3Z m0 1 9 7 9-7",
	call: "m5 3 4 4-2 3c2 4 3 5 7 7l3-2 4 4-3 3C10 21 3 14 2 6Z",
	home: "m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z",
	user: "M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2 M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
	grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
	store:
		"M3 10h18l-2-7H5l-2 7v3a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0v-3 M5 16v5h14v-5 M10 21v-5h4v5",
	shield: "M12 3 3 7v6c0 4 5 7 9 9 4-2 9-5 9-9V7Z m-4 9 3 3 5-6",
	search: "M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
	menu: "M3 6h18 M3 12h18 M3 18h18",
	close: "m5 5 14 14 M19 5 5 19",
	arrow: "M4 12h16 m-6-6 6 6-6 6",
	box: "m12 3 9 5v9l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v9 m-5-17 10 6",
	chevron: "m9 5 7 7-7 7",
	plus: "M12 4v16 M4 12h16",
	file: "M14 2H5v20h14V7Z M14 2v6h5 M8 12h8 M8 16h8",
	help: "M9 8a3 3 0 1 1 5 2c-1 1-2 1-2 4 M12 18h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
	check: "m5 12 4 4L19 6",
	team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M18 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-4",
	lock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
	"chevron-down": "m5 9 7 7 7-7",
	star: "m12 2 3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7Z",
	inbox: "M4 6h16l-2 12H6Z M4 6V4h16v2 M9 12h6",
	copy: "M9 9h11v11H9Z M5 15V4h11",
	clock: "M12 6v6l4 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
	filter: "M4 5h16 M7 12h10 M10 19h4",
	"trending-up": "m4 18 6-6 4 4 6-8 M14 8h6v6",
	"trending-down": "m4 6 6 6 4-4 6 8 M14 16h6v-6",
	"arrow-up": "M12 19V5 M5 12l7-7 7 7",
	"arrow-down": "M12 5v14 M5 12l7 7 7-7",
	"more-horizontal": "M5 12h.01 M12 12h.01 M19 12h.01",
	eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
	sliders: "M4 6h16 M4 12h10 M4 18h6 M18 4v4 M10 10v4 M6 16v4",
} as const;
export type IconName = keyof typeof paths;
export function Icon({
	name,
	className = "size-5",
	...props
}: ComponentProps<"svg"> & { name: IconName }) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={`shrink-0 ${className}`}
			{...props}
		>
			<path d={paths[name]} />
		</svg>
	);
}
