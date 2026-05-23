# Week 3 – School Management System

A Soroban smart contract for managing students and their payment history.

## Functions implemented

- `update_student_class` – update the class of a registered student
- `get_payment_history` – return all payment records for a student
- `remove_student` – remove a student and their payment history from the contract

## Project structure

```text
.
├── contracts/
│   └── school-management/
│       ├── src/
│       │   ├── lib.rs
│       │   └── test.rs
│       └── Cargo.toml
└── Cargo.toml
```

## Running tests

```sh
cargo test
```
