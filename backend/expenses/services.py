from collections import defaultdict

from expenses.models import Expense


def calculate_balances(occasion_id=None):
    """Derive debts from persisted expenses, netting only within each participant pair."""
    totals = defaultdict(int)
    participants = {}
    expenses = Expense.objects.select_related("paid_by", "expense_for")
    if occasion_id is not None:
        expenses = expenses.filter(occasion_id=occasion_id)
    for expense in expenses.iterator():
        payer_id = expense.paid_by_id
        beneficiary_id = expense.expense_for_id
        participants[payer_id] = expense.paid_by
        participants[beneficiary_id] = expense.expense_for
        pair = (min(payer_id, beneficiary_id), max(payer_id, beneficiary_id))
        # Positive totals mean the higher ID owes the lower ID; negative totals reverse it.
        totals[pair] += expense.amount_cents if payer_id == pair[0] else -expense.amount_cents

    balances = []
    for (lower_id, higher_id), cents in totals.items():
        if cents == 0:
            continue
        creditor_id, debtor_id = (lower_id, higher_id) if cents > 0 else (higher_id, lower_id)
        balances.append(
            {
                "debtor": participants[debtor_id],
                "creditor": participants[creditor_id],
                "amount_cents": abs(cents),
            }
        )
    return sorted(balances, key=lambda balance: (balance["debtor"].id, balance["creditor"].id))
