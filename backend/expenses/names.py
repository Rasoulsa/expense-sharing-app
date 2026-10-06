"""Version 1 of occasion-name canonicalization, shared with migration 0004.

Keep this algorithm stable once released. A change requires a new migration to
recompute stored keys and check for new collisions.
"""

from unicodedata import normalize


def canonical_occasion_name(name: str) -> str:
    """Match Unicode canonical equivalents and casing, preserving accents."""
    return normalize("NFC", normalize("NFC", name.strip()).casefold())
