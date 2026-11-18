"use client";
// Legacy control tokens still consumed by orders / marketplace / notifications.
// Messaging itself uses the unified primitives in ./ui.
export { Failure } from "./ui";
export const control =
	"min-h-11 w-full min-w-0 rounded-control border border-border bg-page px-3 py-2 text-foreground disabled:opacity-60";
const buttonBase =
	"inline-flex min-h-11 items-center justify-center rounded-control border border-border px-4 py-2 font-bold disabled:opacity-60";
export const action = `${buttonBase} bg-surface hover:bg-info`;
