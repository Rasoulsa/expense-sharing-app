import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.models import F

from expenses.models import Occasion
from expenses.names import canonical_occasion_name


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        (" Birthday ", "birthday"),
        (" \tÉté\n\u00a0", "été"),
        ("E\u0301TE\u0301", "été"),
        ("Straße", "strasse"),
        ("Σςσ", "σσσ"),
        ("🍽", "🍽"),
    ],
)
def test_canonical_names_use_trim_nfc_and_casefold(name, expected):
    assert canonical_occasion_name(name) == expected
    assert canonical_occasion_name(expected) == expected


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("name", "duplicate"),
    [("Été", "été"), ("Été", "E\u0301te\u0301"), ("Straße", "STRASSE"), ("Birthday", " birthday ")],
)
def test_model_creation_and_validation_reject_unicode_equivalents(name, duplicate):
    first = Occasion.objects.create(name=f"  {name}  ", canonical_name="untrusted key")
    assert first.name == name
    assert first.canonical_name == canonical_occasion_name(name)
    first.full_clean()
    with pytest.raises(ValidationError):
        Occasion(name=duplicate).full_clean()
    with pytest.raises(IntegrityError), transaction.atomic():
        Occasion.objects.create(name=duplicate)
    assert Occasion.objects.count() == 1


@pytest.mark.django_db
def test_model_renames_and_update_fields_keep_canonical_name_in_sync():
    occasion = Occasion.objects.create(name="Birthday")
    occasion.name = " E\u0301te\u0301 "
    occasion.save(update_fields=["name"])
    occasion.refresh_from_db()
    assert occasion.name == "E\u0301te\u0301"
    assert occasion.canonical_name == "été"
    Occasion.objects.filter(pk=occasion.pk).update(name=" Straße ")
    occasion.refresh_from_db()
    assert occasion.name == "Straße"
    assert occasion.canonical_name == "strasse"
    existing = Occasion.objects.create(name="Été")
    before = list(Occasion.objects.order_by("id").values())
    with pytest.raises(IntegrityError), transaction.atomic():
        Occasion.objects.filter(pk=occasion.pk).update(name="été")
    occasion.name = "E\u0301te\u0301"
    with pytest.raises(IntegrityError), transaction.atomic():
        occasion.save(update_fields=["name"])
    assert list(Occasion.objects.order_by("id").values()) == before
    assert existing.canonical_name == "été"


@pytest.mark.django_db
def test_bulk_insert_derives_keys_and_rejects_equivalent_names():
    rows = Occasion.objects.bulk_create([Occasion(name=" ÉTÉ "), Occasion(name=" Birthday ")], 1)
    assert [(row.name, row.canonical_name) for row in rows] == [
        ("ÉTÉ", "été"),
        ("Birthday", "birthday"),
    ]
    with pytest.raises(IntegrityError), transaction.atomic():
        Occasion.objects.bulk_create([Occasion(name="e\u0301te\u0301")])
    assert Occasion.objects.count() == 2


@pytest.mark.django_db
def test_writes_cannot_bypass_canonicalization_with_a_key_or_expression():
    occasion = Occasion.objects.create(name="Été")
    before = list(Occasion.objects.values())
    with pytest.raises(ValueError, match="derived"):
        Occasion.objects.filter(pk=occasion.pk).update(canonical_name="invalid")
    with pytest.raises(ValueError, match="literal string"):
        Occasion.objects.filter(pk=occasion.pk).update(name=F("name"))
    occasion.name = "Birthday"
    with pytest.raises(ValueError, match="bulk name updates"):
        Occasion.objects.bulk_update([occasion], ["name"])
    assert list(Occasion.objects.values()) == before


@pytest.mark.django_db
@pytest.mark.parametrize("key", [None, "", "été"])
def test_database_requires_a_nonblank_unique_canonical_key(key):
    Occasion.objects.create(name="Été")
    with pytest.raises(IntegrityError), transaction.atomic(), connection.cursor() as cursor:
        # Bypass model hooks to prove these are database constraints.
        cursor.execute(
            "INSERT INTO expenses_occasion (name, canonical_name) VALUES (%s, %s)",
            ["Different display name", key],
        )
    assert Occasion.objects.count() == 1


@pytest.mark.django_db
def test_canonicalization_preserves_accents_and_long_casefold_expansions():
    Occasion.objects.create(name="Été")
    Occasion.objects.create(name="Ete")
    expanded = Occasion.objects.create(name="ß" * 100)
    assert expanded.canonical_name == "ss" * 100
    assert Occasion.objects.count() == 3


@pytest.mark.django_db
def test_legacy_positional_save_options_cannot_skip_the_key():
    occasion = Occasion.objects.create(name="Birthday")
    occasion.name = " ÉTÉ "
    with pytest.warns(DeprecationWarning, match="positional arguments"):
        occasion.save(False, False, None, ["name"])
    occasion.refresh_from_db()
    assert occasion.name == "ÉTÉ"
    assert occasion.canonical_name == "été"


@pytest.mark.django_db
def test_bulk_upsert_updates_display_spelling_without_changing_the_key_or_identity():
    occasion = Occasion.objects.create(name="Été")
    Occasion.objects.bulk_create(
        [Occasion(name=" E\u0301TE\u0301 ")],
        update_conflicts=True,
        update_fields=["name"],
        unique_fields=["canonical_name"],
    )
    occasion.refresh_from_db()
    assert occasion.name == "E\u0301TE\u0301"
    assert occasion.canonical_name == "été"
    assert Occasion.objects.count() == 1
