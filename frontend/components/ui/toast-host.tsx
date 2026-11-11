"use client";

import { Toaster } from "react-hot-toast";

export function ToastHost() {
	return (
		<Toaster
			position="top-center"
			toastOptions={{
				className: "!max-w-[calc(100vw-2rem)] !rounded-xl !text-sm",
				success: { duration: 3500 },
				error: { duration: 5000 },
			}}
		/>
	);
}
