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
LISTING_THEME = {"table": "whitespace-nowrap"}
ORDER_THEME = {
    "layout": "flex min-w-0 flex-col gap-6",
    "panel": f"{CARD} flex flex-col gap-3 p-5 text-sm",
    "heading": f"text-xl font-semibold {TEXT}",
    "section_heading": f"text-lg font-semibold {TEXT}",
    "history": f"rounded-default border {DIVIDER} p-3",
    "form": "flex flex-col gap-3",
    "button": "inline-flex items-center justify-center rounded-default bg-primary-600 px-4 py-2 font-medium text-white",
    "label": f"block mb-2 font-medium {TEXT}",
    "error": "text-sm text-red-600 dark:text-red-400",
}
CHIP = (
    "rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-semibold uppercase "
    "text-primary-600 dark:bg-primary-950 dark:text-primary-400"
)

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
        "draft", "referred", "incomplete", "unpaid", "partial", "expiring",
    },
    "success": {
        "approved", "confirmed", "completed", "active", "resolved", "paid", "published",
        "captured", "smtp_accepted", "consumed", "released", "verified", "enabled",
        "overpaid", "delivered", "dispatched", "settled", "recovered", "valid",
    },
    "danger": {
        "rejected", "cancelled", "suspended", "exhausted", "failed", "expired",
        "disabled", "delivery_unknown", "revoked", "blocked", "restricted",
    },
    "info": {
        "held", "reserved", "sealed", "withdrawn", "decided", "erroneous", "running",
        "complete", "done", "reduced", "unreserved", "flat", "unknown",
    },
}

CATALOGUE_THEME = {
    "identity": "flex items-center gap-3",
    "image": "h-10 w-10 shrink-0 rounded-default object-cover",
    "text": "min-w-0 w-48",
    "name": "block truncate text-sm font-medium text-base-900 dark:text-base-100",
    "meta": "block truncate text-xs text-base-500 dark:text-base-400",
    "badges": "flex flex-wrap gap-1",
}

ACCOUNT_THEME = {
    "avatar": "rounded-full bg-primary-50 font-semibold text-primary-700 dark:bg-primary-950 dark:text-primary-400",
    "menu": "rounded-xl border border-base-200 bg-white shadow-lg dark:border-base-700 dark:bg-base-900",
    "trigger": "rounded-lg hover:bg-base-100 dark:hover:bg-base-800",
    "trigger_active": "bg-base-100 dark:bg-base-800",
    "label": f"text-xs font-semibold {MUTED}",
    "row": (
        "rounded-md text-sm font-medium text-base-700 hover:bg-base-100 "
        "dark:text-base-200 dark:hover:bg-base-800"
    ),
    "row_primary": "rounded-md bg-primary-50 text-sm font-semibold text-primary-700 dark:bg-primary-950 dark:text-primary-400",
    "segments": "rounded-lg bg-base-50 dark:bg-base-800",
    "selection": "rounded-md bg-white font-semibold text-primary-700 shadow-sm dark:bg-base-900 dark:text-primary-400",
    "signout": "rounded-md text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/20",
    "record_panel": CARD,
    "record_name": f"text-lg font-semibold {TEXT}",
    "record_meta": f"text-sm {MUTED}",
    "record_link": (
        f"rounded-md border {DIVIDER} px-3 py-1.5 text-sm font-medium "
        "hover:bg-base-100 dark:hover:bg-base-800"
    ),
    "profile_heading": SECTION_TITLE,
    "profile_value": f"break-words text-sm font-medium {TEXT}",
}

DIRECTORY_THEME = {
    "backdrop": "bg-base-900/20 backdrop-blur-xs dark:bg-base-900/80",
    "panel": f"border-e {DIVIDER} bg-white shadow-lg dark:bg-base-900",
    "divider": DIVIDER,
    "title": SECTION_TITLE,
    "muted": MUTED,
    "icon": ICON_TILE,
    "input": f"rounded-lg border {DIVIDER} bg-base-50 text-sm dark:bg-base-800 {TEXT}",
    "button": f"rounded-md hover:bg-base-100 dark:hover:bg-base-800 {MUTED}",
    "group": f"rounded-xl border {DIVIDER}",
    "heading": f"rounded-xl px-3 py-2 font-semibold hover:bg-base-50 dark:hover:bg-base-800 {TEXT}",
    "subheading": f"rounded-md px-3 py-2 font-medium hover:bg-base-100 dark:hover:bg-base-800 {TEXT}",
    "count": f"rounded-md bg-base-100 px-1.5 py-0.5 text-xs dark:bg-base-800 {MUTED}",
    "link": f"rounded-md hover:bg-base-100 dark:hover:bg-base-800 {TEXT}",
    "current_link": ACCOUNT_THEME["row_primary"],
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
    "overview_banner": "rounded-2xl bg-linear-to-br from-primary-950 to-primary-700 text-white shadow-lg dark:to-primary-900",
    "overview_ring": "absolute aspect-square rounded-full border border-primary-600 opacity-50",
    "overview_priority_panel": "rounded-xl border border-primary-700 bg-base-900/20",
    "overview_priority_colors": {"urgent": "bg-red-300", "today": "bg-orange-300", "routine": "bg-blue-300"},
    "overview_priority_track": "bg-white/20",
    "overview_banner_muted": "text-primary-100",
    "overview_button": "rounded-md bg-white text-primary-900 hover:bg-primary-50",
    "overview_panel": f"flex h-72 min-w-0 flex-col overflow-hidden {CARD}",
    "overview_empty_icon": "rounded-2xl bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400",
    "overview_empty_check": (
        "rounded-full border-2 border-white bg-green-100 text-green-700 "
        "dark:border-base-900 dark:bg-green-950 dark:text-green-400"
    ),
    "overview_row_icon": "rounded-md bg-base-50 text-base-600 dark:bg-base-800 dark:text-base-300",
    "overview_area_icons": {
        "trading": "bg-primary-50 text-primary-600 dark:bg-primary-950 dark:text-primary-400",
        "marketplace": "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
        "platform": "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400",
    },
    "overview_notice": "rounded-xl bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
    "overview_table_head": "bg-base-50 dark:bg-base-800",
    "queue_filter": "rounded-md px-3 py-2 text-xs font-medium hover:bg-base-100 dark:hover:bg-base-800",
    "queue_filter_active": "bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-400",
    "queue_row_hover": "hover:bg-base-50 dark:hover:bg-base-800",
    "queue_badge": {key: f"{BADGE_BASE} {value}" for key, value in BADGE_COLORS.items()},
}
