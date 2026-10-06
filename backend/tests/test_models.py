from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.db import DataError, IntegrityError, connection, transaction
from django.db.models.deletion import ProtectedError
from django.utils import timezone

from expenses.models import Expense, Occasion, Participant

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("name", ["", "   "])
def test_empty_participant_name_rejected_by_database(name):
    with pytest.raises(IntegrityError), transaction.atomic():
        Participant.objects.create(name=name)


def test_participant_name_is_unique():
    Participant.objects.create(name="Alice")
    with pytest.raises(IntegrityError), transaction.atomic():
        Participant.objects.create(name="Alice")


@pytest.mark.parametrize("name", ["", " \t\n", "a" * 101])
def test_invalid_participant_name_fails_validation(name):
    with pytest.raises(ValidationError):
        Participant(name=name).full_clean()


@pytest.mark.parametrize("name", ["", "   "])
def test_empty_occasion_name_rejected_by_database(name):
    with pytest.raises(IntegrityError), transaction.atomic():
        Occasion.objects.create(name=name)


@pytest.mark.parametrize("name", ["Birthday", "birthday", "BIRTHDAY", " Birthday ", "  bIrThDaY  "])
def test_occasion_name_is_unique_after_trimming_and_ignoring_case(name):
    Occasion.objects.create(name="Birthday")
    with pytest.raises(IntegrityError), transaction.atomic():
        Occasion.objects.create(name=name)


@pytest.mark.parametrize("name", ["", " \t\n", "x" * 101])
def test_invalid_occasion_name_fails_validation(name):
    with pytest.raises(ValidationError):
        Occasion(name=name).full_clean()


def test_occasion_name_limit_enforced_by_database():
    database_error = DataError if connection.vendor == "postgresql" else IntegrityError
    with pytest.raises(database_error), transaction.atomic():
        Occasion.objects.create(name="x" * 101)


def test_expense_occasion_is_optional_and_protected():
    alice = Participant.objects.create(name="Alice")
    bob = Participant.objects.create(name="Bob")
    ungrouped = Expense.objects.create(paid_by=alice, expense_for=bob, amount_cents=500)
    assert ungrouped.occasion_id is None
    ungrouped.full_clean()

    occasion = Occasion.objects.create(name="Dinner")
    expense = Expense.objects.create(
        paid_by=alice, expense_for=bob, amount_cents=1234, occasion=occasion
    )
    expense.full_clean()
    with pytest.raises(ProtectedError):
        occasion.delete()
    expense.refresh_from_db()
    assert expense.occasion_id == occasion.id


@pytest.mark.parametrize("amount", [0, -1])
def test_nonpositive_expense_rejected_by_database(amount):
    payer = Participant.objects.create(name="Alice")
    beneficiary = Participant.objects.create(name="Bob")
    with pytest.raises(IntegrityError), transaction.atomic():
        Expense.objects.create(paid_by=payer, expense_for=beneficiary, amount_cents=amount)


def test_same_payer_and_beneficiary_rejected_by_database():
    person = Participant.objects.create(name="Alice")
    with pytest.raises(IntegrityError), transaction.atomic():
        Expense.objects.create(paid_by=person, expense_for=person, amount_cents=50)


def test_description_limit_enforced_by_validation_and_database():
    payer = Participant.objects.create(name="Alice")
    beneficiary = Participant.objects.create(name="Bob")
    expense = Expense(paid_by=payer, expense_for=beneficiary, amount_cents=1, description="x" * 501)
    with pytest.raises(ValidationError):
        expense.full_clean()
    # PostgreSQL's varchar(500) rejects oversized values before the check constraint.
    database_error = DataError if connection.vendor == "postgresql" else IntegrityError
    with pytest.raises(database_error), transaction.atomic():
        expense.save()


def test_valid_directional_expense_preserves_fields_and_uses_utc():
    payer = Participant.objects.create(name="Alice")
    beneficiary = Participant.objects.create(name="Bob")
    before = timezone.now()
    expense = Expense.objects.create(
        paid_by=payer, expense_for=beneficiary, amount_cents=1234, description="x" * 500
    )
    expense.refresh_from_db()
    assert expense.paid_by == payer
    assert expense.expense_for == beneficiary
    assert expense.amount_cents == 1234
    assert len(expense.description) == 500
    assert before <= expense.created_at <= timezone.now()
    assert expense.created_at.utcoffset() == timedelta(0)
    with pytest.raises(ProtectedError):
        payer.delete()
    with pytest.raises(ProtectedError):
        beneficiary.delete()


def test_database_is_isolated_from_local_development_database(settings):
    assert connection.settings_dict["NAME"] != settings.BASE_DIR / ".local" / "expenses.sqlite3"
    if connection.vendor == "sqlite":
        assert "memory" in str(connection.settings_dict["NAME"])
    else:
        assert connection.vendor == "postgresql"
        assert str(connection.settings_dict["NAME"]).startswith("test_")
