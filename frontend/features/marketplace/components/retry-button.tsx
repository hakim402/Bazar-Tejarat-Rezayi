"use client";
import { Button } from "../../../components/ui/button";
export function RetryButton({ label }: { label: string }) {
	return (
		<Button variant="secondary" onClick={() => location.reload()}>
			{label}
		</Button>
	);
}
