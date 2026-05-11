# Interactive Expense Manager

A command-line expense manager built with Rust. This project demonstrates the use of loops, hash maps, modularity and interactive user input.

## Features

### Stage 1: Basic Management
- Add expenses with a name and amount.
- View existing expenses.

### Stage 2: Removal
- Remove expenses from the system by name.

### Stage 3: Editing and Navigation
- Edit the amount of existing expenses.
- Navigate back to the main menu using the `back` keyword.

## How to Run

Ensure you have Rust installed.

1. Navigate to the project directory:
   ```bash
   cd week-1/expense-manager
   ```
2. Run the application:
   ```bash
   cargo run
   ```

## Project Structure
- `src/main.rs`: Entry point and main menu loop.
- `src/expenses.rs`: Expense data structure and management logic.
- `src/cli.rs`: Reusable CLI input helpers.
