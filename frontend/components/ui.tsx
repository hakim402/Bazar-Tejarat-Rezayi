import type {
	ButtonHTMLAttributes,
	InputHTMLAttributes,
	ReactNode,
} from "react";
export function Button({
	className = "",
	...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
	return <button className={`button ${className}`} {...props} />;
}
export function Notice({
	children,
	error = false,
}: {
	children: ReactNode;
	error?: boolean;
}) {
	return (
		<div
			className={`notice ${error ? "notice-error" : ""}`}
			role={error ? "alert" : "status"}
		>
			{children}
		</div>
	);
}
export function Card({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return <section className={`card ${className}`}>{children}</section>;
}
export function Field({
	label,
	id,
	error,
	...props
}: InputHTMLAttributes<HTMLInputElement> & {
	label: string;
	id: string;
	error?: string;
}) {
	return (
		<label className="field" htmlFor={id}>
			{label}
			<input
				id={id}
				aria-invalid={!!error}
				aria-describedby={error ? `${id}-error` : undefined}
				{...props}
			/>
			{error && <span id={`${id}-error`}>{error}</span>}
		</label>
	);
}
export function Ltr({ children }: { children: ReactNode }) {
	return (
		<bdi dir="ltr" className="ltr">
			{children}
		</bdi>
	);
}
