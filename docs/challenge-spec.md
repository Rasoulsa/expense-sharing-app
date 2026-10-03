# Expense-sharing application — original challenge specification

Build a small full-stack expense-sharing application inspired by Splitwise.
The application should allow users to record expenses between users and view their current balances.

## Requirements

- Users are seeded beforehand. No login, authentication, registration, or user creation is required.
- Any database may be used, although SQLite is preferred for simplicity.
- Any TypeScript framework may be used. Frontend and backend may be separate or unified.
- The application must work end-to-end, with the frontend communicating with the backend API.

## UI

The application has one page with two main views:

- Expenses: display the list of expenses, including who paid, who the expense was for, amount, description, and date.
- Balances: display the current net balance between users.

Examples:

- Alice owes Bob $120
- Charlie owes Alice $50
- David owes Bob $30

The page also has an Add Expense button that opens a modal with:

- Paid by
- Expense for
- Amount
- Description

An expense represents a single directional transaction. For example,
Alice → Bob → $50 means Bob owes Alice $50. Multiple transactions between
the same users should be netted when displaying balances.

## Submission

- A GitHub repository URL containing the complete source code.
- A README with setup and run instructions.
- A publicly accessible deployment.

The application must be deployed on a cloud platform accessible from Iran.
Hamravesh is an example platform and offers signup credits/discounts for this
challenge. The challenge allows almost one week and permits the use of AI tools.

The choice of technologies, architecture, database schema, API design, and UI
implementation is up to the developer.

The focus is a clean, functional end-to-end application with both frontend and
backend implemented.
