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
	image:
		"M3 5h18v14H3Z M9 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0 M3 17l5-5 4 4 3-3 6 6",
	sliders: "M4 6h16 M4 12h10 M4 18h6 M18 4v4 M10 10v4 M6 16v4",
	warehouse: "M3 21V8l9-5 9 5v13 M3 21h18 M7 21V11h10v10 M7 15h10 M7 18h10",
	history: "M3 11a9 9 0 1 1 2.6 7.4 M3 4v7h7 M12 7v5l3 2",
	"shopping-bag": "M5 7h14l2 14H3Z M8 9V6a4 4 0 0 1 8 0v3",
	handshake:
		"m2 8 4-4 4 2h4l4-2 4 4-3 7 M2 8l3 7 5 5a2 2 0 0 0 3-1 M6 5l-2 2 M18 5l2 2 M14 6l-5 5a2 2 0 0 0 3 2l2-2 5 5a2 2 0 0 1-3 3l-4-4 M16 19l-5-5",
	truck:
		"M2 4h12v13H2Z M14 8h4l4 5v4h-8 M14 13h8 M8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
	return: "M9 4 3 10l6 6 M3 10h11a7 7 0 0 1 7 7v3",
	receipt: "M5 3l3 2 4-2 4 2 3-2v18l-3-2-4 2-4-2-3 2Z M8 9h8 M8 13h8 M8 17h4",
	wallet:
		"M20 7V4H5a3 3 0 0 0 0 6h16v11H5a3 3 0 0 1-3-3V7 M21 13h-5v5h5 M17 15.5h.01",
	"user-circle":
		"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M15 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 18a7 7 0 0 1 14 0",
	gear: "m10 2-.7 3-2 .9-2.7-.9-2 3.5 2 2v3l-2 2 2 3.5 2.7-.9 2 .9.7 3h4l.7-3 2-.9 2.7.9 2-3.5-2-2v-3l2-2-2-3.5-2.7.9-2-.9-.7-3Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
	"shield-lock":
		"M12 3 3 7v6c0 4 5 7 9 9 4-2 9-5 9-9V7Z M8 11h8v6H8Z M10 11V9a2 2 0 0 1 4 0v2",
	link: "m10 13 4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
	sun: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5",
	moon: "M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10Z",
	monitor: "M2 4h20v12H2Z M8 20h8 M12 16v4",
	more: "M5 12h.01 M12 12h.01 M19 12h.01",
	"alert-triangle": "M12 3 22 20H2Z M12 9v4.5 M12 17h.01",
	"check-circle": "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 m-14 1 3 3 5.5-6",
	"map-pin":
		"M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
	headset:
		"M3 11a9 9 0 0 1 18 0 M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Z M21 11h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-5Z M21 16v2a4 4 0 0 1-4 4h-5",
	award:
		"M18 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z M15.5 12.5 17 22l-5-3-5 3 1.5-9.5",
	crown: "m3 6 4.5 4L12 4l4.5 6L21 6l-2 12H5Z M5 21h14",
	trash: "M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6",
	minus: "M5 12h14",
	share: "M12 3v12 m-4-8 4-4 4 4 M5 12v8h14v-8",
	"zoom-in": "M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0 M10 7v6 M7 10h6",
} as const;
export type IconName = keyof typeof paths;
export function Icon({
	name,
	className = "size-5",
	...props
}: ComponentProps<"svg"> & { name: IconName }) {
	const directional =
		name === "arrow" ||
		name.startsWith("arrow-") ||
		name.startsWith("chevron") ||
		name.startsWith("trending-") ||
		name === "return";
	const mirror = directional && !/\b(?:ltr|rtl):rotate-180\b/.test(className);

	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.7"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			className={`shrink-0 ${mirror ? "rtl:-scale-x-100" : ""} ${className}`}
			{...props}
		>
			<path d={paths[name]} />
		</svg>
	);
}
