import re
from datetime import UTC
from decimal import Decimal

from django.db import IntegrityError, transaction
from rest_framework import serializers

from expenses.models import Expense, Occasion, Participant
from expenses.names import canonical_occasion_name


class ParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Participant
        fields = ["id", "name"]
        read_only_fields = fields


class OccasionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Occasion
        fields = ["id", "name"]
        read_only_fields = ["id"]
        extra_kwargs = {"name": {"trim_whitespace": True, "validators": []}}

    @staticmethod
    def name_exists(name):
        return Occasion.objects.filter(canonical_name=canonical_occasion_name(name)).exists()

    def validate_name(self, value):
        if self.name_exists(value):
            raise serializers.ValidationError(
                "An occasion with this name already exists (case-insensitive)."
            )
        return value

    def create(self, validated_data):
        try:
            with transaction.atomic():
                return super().create(validated_data)
        except IntegrityError:
            # A concurrent request may have claimed the name after validation.
            if self.name_exists(validated_data["name"]):
                raise serializers.ValidationError(
                    {"name": ["An occasion with this name already exists (case-insensitive)."]}
                ) from None
            raise


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


class OccasionIdField(serializers.PrimaryKeyRelatedField):
    def to_internal_value(self, data):
        if type(data) is not int or not 0 < data <= 2**63 - 1:
            raise serializers.ValidationError("Occasion ID must be a positive JSON integer.")
        return super().to_internal_value(data)


class OccasionFilterSerializer(serializers.Serializer):
    occasion = serializers.RegexField(r"\A[0-9]+\Z", required=False, trim_whitespace=False)

    def validate_occasion(self, value):
        if len(value) > 19 or not 0 < int(value) <= 2**63 - 1:
            raise serializers.ValidationError("Enter a positive integer occasion ID.")
        return int(value)


class ExpenseSerializer(serializers.ModelSerializer):
    paid_by = ParticipantIdField(queryset=Participant.objects.all())
    expense_for = ParticipantIdField(queryset=Participant.objects.all())
    occasion = OccasionIdField(queryset=Occasion.objects.all(), required=False, allow_null=True)
    amount = ExpenseAmountField(source="amount_cents")
    description = serializers.CharField(
        max_length=Expense._meta.get_field("description").max_length
    )
    created_at = serializers.DateTimeField(read_only=True, format="iso-8601", default_timezone=UTC)

    class Meta:
        model = Expense
        fields = ["id", "paid_by", "expense_for", "occasion", "amount", "description", "created_at"]
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
        data["occasion"] = (
            OccasionSerializer(instance.occasion).data if instance.occasion is not None else None
        )
        return data


class BalanceSerializer(serializers.Serializer):
    debtor = ParticipantSerializer(read_only=True)
    creditor = ParticipantSerializer(read_only=True)
    amount = ExpenseAmountField(source="amount_cents", read_only=True)
