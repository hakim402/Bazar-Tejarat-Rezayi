"""Single source of truth for owner-admin presentation.

Every class below ships in Unfold's compiled ``static/unfold/css/styles.css`` —
no custom Tailwind build is required. ``admin_display`` consumes the badge palette
and the dashboard context exposes ``THEME`` so templates never hard-code colours.
Display-only: no permission, guard or business behavior lives here.
"""

# --- Neutral surfaces & text (theme-aware light/dark) -----------------------
CARD = "rounded-lg border border-base-200 bg-white shadow-sm dark:border-base-800 dark:bg-base-900"
CARD_HOVER = "transition-colors hover:border-primary-400"
TEXT = "text-base-900 dark:text-base-100"
MUTED = "text-base-500 dark:text-base-400"
FAINT = "text-base-400 dark:text-base-500"
ACTION = "text-primary-600 dark:text-primary-400"
DIVIDER = "border-base-200 dark:border-base-800"
ICON_TILE = (
    "flex shrink-0 items-center justify-center rounded-md bg-primary-50 "
    "text-primary-600 dark:bg-primary-950 dark:text-primary-400"
)
SECTION_TITLE = "text-base font-semibold text-base-900 dark:text-base-100"
CHIP = (
    "rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-semibold uppercase "
    "text-primary-600 dark:bg-primary-950 dark:text-primary-400"
)

# --- Trend chip colours (truthful deltas; never invented) -------------------
DELTA = {
    "up": "text-green-700 dark:text-green-400",
    "down": "text-red-700 dark:text-red-400",
    "flat": MUTED,
}

# --- Status badge palette (moved verbatim from admin_display) ---------------
BADGE_BASE = (
    "font-semibold h-[18px] leading-[18px] px-1 rounded-xs text-center text-[11px] "
    "whitespace-nowrap uppercase min-w-[18px] inline-block align-middle"
)
BADGE_COLORS = {
    "warning": "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
    "success": "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400",
    "danger": "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400",
    "info": "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400",
    "default": "bg-base-100 text-base-700 dark:bg-base-500/20 dark:text-base-400",
}
STATE_VARIANTS = {
    "warning": {
        "pending", "open", "submitted", "under_review", "reported", "review_required",
        "shortage", "blocked_zero", "queued", "retry_due", "claimed", "dispatching",
        "draft", "referred", "incomplete", "unpaid", "partial",
    },
    "success": {
        "approved", "confirmed", "completed", "active", "resolved", "paid", "published",
        "captured", "smtp_accepted", "consumed", "released", "verified", "enabled",
        "overpaid", "delivered", "dispatched", "settled",
    },
    "danger": {
        "rejected", "cancelled", "suspended", "exhausted", "failed", "expired",
        "disabled", "delivery_unknown", "revoked", "blocked",
    },
    "info": {
        "held", "reserved", "sealed", "withdrawn", "decided", "erroneous", "running",
        "complete", "done", "reduced", "unreserved", "flat", "unknown",
    },
}

# --- Template-facing map (injected as ``rz_theme`` by dashboard_context) ----
# Never name the context key ``theme``: Unfold's skeleton owns that key for the
# root Alpine theme() component (light/dark/auto string).
THEME = {
    "card": CARD,
    "card_hover": CARD_HOVER,
    "text": TEXT,
    "muted": MUTED,
    "faint": FAINT,
    "action": ACTION,
    "divider": DIVIDER,
    "icon_tile": ICON_TILE,
    "section_title": SECTION_TITLE,
    "chip": CHIP,
    "delta": DELTA,
}
