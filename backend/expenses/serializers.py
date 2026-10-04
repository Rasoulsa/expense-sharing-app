import re
from datetime import UTC
from decimal import Decimal

from rest_framework import serializers

from expenses.models import Expense, Participant


class ParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Participant
        fields = ["id", "name"]


class ExpenseAmountField(serializers.Field):
    def to_internal_value(self, data):
        if not isinstance(data, str) or re.fullmatch(r"[0-9]+(?:\.[0-9]{1,2})?", data) is None:
            raise serializers.ValidationError(
                "Enter a decimal string with up to two decimal places (for example, '12.34')."
            )
        amount = Decimal(data)
        if not Decimal("0") < amount <= Decimal("999999.99"):
            raise serializers.ValidationError("Amount must be between 0.01 and 999999.99.")
        return int(amount * 100)

    def to_representation(self, value):
        return format(Decimal(value) / 100, ".2f")


class ParticipantIdField(serializers.PrimaryKeyRelatedField):
    def to_internal_value(self, data):
        # An exact type check also rejects bool, which is an int subclass in Python.
        if type(data) is not int:
            raise serializers.ValidationError("Participant ID must be a JSON integer.")
        return super().to_internal_value(data)


class ExpenseSerializer(serializers.ModelSerializer):
    paid_by = ParticipantIdField(queryset=Participant.objects.all())
    expense_for = ParticipantIdField(queryset=Participant.objects.all())
    amount = ExpenseAmountField(source="amount_cents")
    description = serializers.CharField(
        max_length=Expense._meta.get_field("description").max_length
    )
    created_at = serializers.DateTimeField(read_only=True, format="iso-8601", default_timezone=UTC)

    class Meta:
        model = Expense
        fields = ["id", "paid_by", "expense_for", "amount", "description", "created_at"]
        read_only_fields = ["id"]

    def validate(self, attrs):
        if attrs["paid_by"] == attrs["expense_for"]:
            raise serializers.ValidationError(
                {"expense_for": "The beneficiary must be different from the payer."}
            )
        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["paid_by"] = ParticipantSerializer(instance.paid_by).data
        data["expense_for"] = ParticipantSerializer(instance.expense_for).data
        return data


class BalanceSerializer(serializers.Serializer):
    debtor = ParticipantSerializer(read_only=True)
    creditor = ParticipantSerializer(read_only=True)
    amount = ExpenseAmountField(source="amount_cents", read_only=True)
