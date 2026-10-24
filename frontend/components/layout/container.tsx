import type { ComponentProps } from "react";
export function Container({ className = "", ...props }: ComponentProps<"div">) {
	return (
		<div
			className={`mx-auto w-full max-w-page px-4 desktop:px-8 ${className}`}
			{...props}
		/>
	);
}
