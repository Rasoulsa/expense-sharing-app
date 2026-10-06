from io import StringIO

import pytest
from django.core.management import call_command

from expenses.models import Expense, Participant


@pytest.mark.django_db
def test_seed_twice_preserves_participants_and_expenses():
    call_command("seed_participants", stdout=StringIO())
    participants = list(Participant.objects.values("id", "name"))
    assert [person["name"] for person in participants] == ["Alice", "Bob", "Charlie", "David"]
    assert len(participants) == 4
    Expense.objects.create(
        paid_by=Participant.objects.get(name="Alice"),
        expense_for=Participant.objects.get(name="Bob"),
        amount_cents=5000,
        description="Dinner",
    )
    expenses = list(Expense.objects.values())
    output = StringIO()
    call_command("seed_participants", stdout=output)
    assert "0 created" in output.getvalue()
    assert list(Participant.objects.values("id", "name")) == participants
    assert list(Expense.objects.values()) == expenses


@pytest.mark.django_db
def test_seed_keeps_preexisting_extra_participants_and_their_expenses():
    call_command("seed_participants", stdout=StringIO())
    existing = Participant.objects.create(name="Eve")
    Expense.objects.create(
        paid_by=Participant.objects.get(name="Alice"),
        expense_for=existing,
        amount_cents=500,
        description="Coffee",
    )
    participants = list(Participant.objects.values())
    expenses = list(Expense.objects.values())
    for _ in range(2):
        call_command("seed_participants", stdout=StringIO())
        assert list(Participant.objects.values()) == participants
        assert list(Expense.objects.values()) == expenses
    assert Participant.objects.count() == 5
