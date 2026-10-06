import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from expenses.models import Expense, Occasion, Participant
from expenses.names import canonical_occasion_name


@pytest.mark.django_db(transaction=True)
def test_occasion_migration_preserves_old_participants_expenses_and_balances(client):
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    old_target = [("expenses", "0001_initial")]
    executor.migrate(old_target)
    try:
        old_apps = executor.loader.project_state(old_target).apps
        old_participant = old_apps.get_model("expenses", "Participant")
        old_expense = old_apps.get_model("expenses", "Expense")
        alice = old_participant.objects.create(id=17, name="Alice")
        bob = old_participant.objects.create(id=23, name="Bob")
        eve = old_participant.objects.create(id=99, name="Eve")
        for expense_id, payer, beneficiary, cents in [
            (81, alice, bob, 5000),
            (82, bob, alice, 2000),
            (83, alice, eve, 500),
        ]:
            old_expense.objects.create(
                id=expense_id,
                paid_by=payer,
                expense_for=beneficiary,
                amount_cents=cents,
                description=f"Legacy expense {expense_id}",
            )
        participants_before = list(old_participant.objects.values())
        expenses_before = list(old_expense.objects.order_by("id").values())

        # The actual pre-migration database has neither the table nor the FK column.
        response = client.get("/health/ready/")
        assert response.status_code == 503
        assert response.json() == {"status": "not_ready"}
        assert client.get("/health/live/").status_code == 200

        MigrationExecutor(connection).migrate(latest)

        assert list(Participant.objects.values()) == participants_before
        assert list(Expense.objects.order_by("id").values()) == [
            {**expense, "occasion_id": None} for expense in expenses_before
        ]
        assert Occasion.objects.count() == 0
        response = client.get("/api/expenses/")
        assert response.status_code == 200
        assert {row["id"] for row in response.json()} == {81, 82, 83}
        assert all(row["occasion"] is None for row in response.json())
        assert client.get("/api/participants/").json() == participants_before
        balances = client.get("/api/balances/")
        assert balances.status_code == 200
        assert balances.json() == [
            {
                "debtor": {"id": bob.id, "name": "Bob"},
                "creditor": {"id": alice.id, "name": "Alice"},
                "amount": "30.00",
            },
            {
                "debtor": {"id": eve.id, "name": "Eve"},
                "creditor": {"id": alice.id, "name": "Alice"},
                "amount": "5.00",
            },
        ]
        response = client.get("/health/ready/")
        assert response.status_code == 200
        assert response.json() == {"status": "ready"}

        # The still-running previous backend ignores the additive table/column.
        # Its old ORM can continue recording ungrouped expenses after the upgrade.
        legacy_write = old_expense.objects.create(
            paid_by=alice,
            expense_for=bob,
            amount_cents=700,
            description="Old client during rollout",
        )
        assert Expense.objects.get(id=legacy_write.id).occasion_id is None
        assert client.get("/api/balances/").json()[0]["amount"] == "37.00"
        assert list(Participant.objects.values()) == participants_before
    finally:
        # Leave the shared test schema current even if an upgrade assertion fails.
        MigrationExecutor(connection).migrate(latest)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("collision", [False, True])
def test_name_constraint_migration_preserves_rows_and_reports_collisions(collision):
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    previous = [("expenses", "0002_occasions")]
    executor.migrate(previous)
    old_apps = executor.loader.project_state(previous).apps
    old_occasion = old_apps.get_model("expenses", "Occasion")
    old_expense = old_apps.get_model("expenses", "Expense")
    old_participant = old_apps.get_model("expenses", "Participant")
    try:
        alice = old_participant.objects.create(id=17, name="Alice")
        bob = old_participant.objects.create(id=23, name="Bob")
        first = old_occasion.objects.create(id=201, name="Birthday")
        second = old_occasion.objects.create(id=202, name="birthday" if collision else "Trip")
        third = old_occasion.objects.create(id=203, name=" Birthday " if collision else "Dinner")
        for index, occasion in enumerate([first, second, third, None], start=81):
            old_expense.objects.create(
                id=index,
                paid_by=alice,
                expense_for=bob,
                occasion=occasion,
                amount_cents=index,
                description=f"Preserve {index}",
            )
        people_before = list(old_participant.objects.values())
        expenses_before = list(old_expense.objects.order_by("id").values())
        occasions_before = list(old_occasion.objects.order_by("id").values())
        if collision:
            with pytest.raises(RuntimeError, match=r"Conflicting occasion IDs: \[201, 202, 203\]"):
                MigrationExecutor(connection).migrate(latest)
            assert list(old_occasion.objects.order_by("id").values()) == occasions_before
            assert list(old_expense.objects.order_by("id").values()) == expenses_before
            assert not MigrationExecutor(connection).loader.applied_migrations.get(
                ("expenses", "0003_occasion_case_insensitive_names")
            )
            # An explicit owner-approved rename preserves the distinct identities and FKs.
            old_occasion.objects.filter(id=202).update(name="Birthday trip")
            old_occasion.objects.filter(id=203).update(name="Birthday dinner")
            occasions_before = list(old_occasion.objects.order_by("id").values())
        MigrationExecutor(connection).migrate(latest)
        assert list(Participant.objects.values()) == people_before
        assert list(Occasion.objects.order_by("id").values("id", "name")) == occasions_before
        assert list(Occasion.objects.order_by("id").values_list("canonical_name", flat=True)) == [
            canonical_occasion_name(row["name"]) for row in occasions_before
        ]
        assert list(Expense.objects.order_by("id").values()) == expenses_before
    finally:
        # Restore the latest schema even if a collision assertion failed.
        if collision:
            old_occasion.objects.filter(id=202).update(name="Birthday trip")
            old_occasion.objects.filter(id=203).update(name="Birthday dinner")
        MigrationExecutor(connection).migrate(latest)


@pytest.mark.django_db(transaction=True)
def test_unicode_key_backfill_preserves_spelling_participants_expenses_and_balances(client):
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    previous = [("expenses", "0003_occasion_case_insensitive_names")]
    executor.migrate(previous)
    old_apps = executor.loader.project_state(previous).apps
    old_occasion = old_apps.get_model("expenses", "Occasion")
    old_expense = old_apps.get_model("expenses", "Expense")
    old_participant = old_apps.get_model("expenses", "Participant")
    try:
        alice = old_participant.objects.create(id=17, name="Alice")
        bob = old_participant.objects.create(id=23, name="Bob")
        names = ["Été", "Cafe\u0301", " Straße ", "\tBirthday\n", "ß" * 100]
        occasions = [
            old_occasion.objects.create(id=index, name=name)
            for index, name in enumerate(names, start=201)
        ]
        for index, occasion in enumerate([*occasions, None], start=81):
            old_expense.objects.create(
                id=index,
                paid_by=alice,
                expense_for=bob,
                occasion=occasion,
                amount_cents=100,
                description=f"Preserve {index}",
            )
        people_before = list(old_participant.objects.values())
        occasions_before = list(old_occasion.objects.order_by("id").values())
        expenses_before = list(old_expense.objects.order_by("id").values())
        assert client.get("/health/ready/").status_code == 503
        assert client.get("/health/live/").status_code == 200
        MigrationExecutor(connection).migrate(latest)
        assert list(Participant.objects.values()) == people_before
        assert list(Expense.objects.order_by("id").values()) == expenses_before
        assert list(Occasion.objects.order_by("id").values()) == [
            {**row, "canonical_name": canonical_occasion_name(row["name"])}
            for row in occasions_before
        ]
        assert client.get("/health/ready/").status_code == 200
        rows = client.get("/api/expenses/").json()
        assert {row["id"] for row in rows} == {row["id"] for row in expenses_before}
        assert [row["occasion"]["id"] if row["occasion"] else None for row in rows] == [
            None,
            *reversed([row.id for row in occasions]),
        ]
        assert client.get("/api/balances/").json()[0]["amount"] == "6.00"
        for occasion in occasions:
            assert (
                client.get("/api/balances/", {"occasion": occasion.pk}).json()[0]["amount"]
                == "1.00"
            )
            assert len(client.get("/api/expenses/", {"occasion": occasion.pk}).json()) == 1
        # The current production backend (0001) can still create ungrouped expenses.
        old_expense.objects.create(paid_by=alice, expense_for=bob, amount_cents=100)
        assert Expense.objects.filter(occasion__isnull=True).count() == 2
    finally:
        MigrationExecutor(connection).migrate(latest)


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize(
    ("first_name", "second_name"),
    [("Été", "E\u0301TE\u0301"), ("Straße", "STRASSE"), ("Birthday", "\tbirthday\n")],
)
def test_unicode_key_migration_reports_colliding_rows_without_changing_associations(
    first_name, second_name
):
    executor = MigrationExecutor(connection)
    latest = executor.loader.graph.leaf_nodes()
    previous = [("expenses", "0003_occasion_case_insensitive_names")]
    executor.migrate(previous)
    old_apps = executor.loader.project_state(previous).apps
    old_occasion = old_apps.get_model("expenses", "Occasion")
    old_expense = old_apps.get_model("expenses", "Expense")
    old_participant = old_apps.get_model("expenses", "Participant")
    try:
        alice = old_participant.objects.create(name="Alice")
        bob = old_participant.objects.create(name="Bob")
        first = old_occasion.objects.create(id=201, name=first_name)
        second = old_occasion.objects.create(id=202, name=second_name)
        for occasion in [first, second, None]:
            old_expense.objects.create(
                paid_by=alice,
                expense_for=bob,
                occasion=occasion,
                amount_cents=100,
                description="Keep the original assignment",
            )
        before_occasions = list(old_occasion.objects.order_by("id").values())
        before_expenses = list(old_expense.objects.order_by("id").values())
        with pytest.raises(RuntimeError, match="Unicode NFC") as error:
            MigrationExecutor(connection).migrate(latest)
        for row in before_occasions:
            assert f"id={row['id']}, name={row['name']!r}" in str(error.value)
        assert "No rows have been changed or merged" in str(error.value)
        assert list(old_occasion.objects.order_by("id").values()) == before_occasions
        assert list(old_expense.objects.order_by("id").values()) == before_expenses
        assert ("expenses", "0004_occasion_canonical_names") not in (
            MigrationExecutor(connection).loader.applied_migrations
        )
        with connection.cursor() as cursor:
            columns = connection.introspection.get_table_description(cursor, "expenses_occasion")
        assert "canonical_name" not in {column.name for column in columns}
        # Rehearse an explicit rename without merging identities or reassigning expenses.
        old_occasion.objects.filter(pk=second.pk).update(name="Renamed distinct occasion")
        MigrationExecutor(connection).migrate(latest)
        assert list(Expense.objects.order_by("id").values()) == before_expenses
        assert Occasion.objects.get(pk=first.pk).name == first_name
        assert Occasion.objects.get(pk=second.pk).name == "Renamed distinct occasion"
        assert Occasion.objects.get(pk=first.pk).canonical_name == canonical_occasion_name(
            first_name
        )
    finally:
        old_occasion.objects.filter(pk=202).update(name="Renamed distinct occasion")
        MigrationExecutor(connection).migrate(latest)
