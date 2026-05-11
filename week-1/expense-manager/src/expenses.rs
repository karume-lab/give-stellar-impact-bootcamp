use std::collections::HashMap;
use crate::cli::{get_input, get_amount_input};

#[derive(Debug)]
pub struct Expense {
    pub name: String,
    pub amount: f64,
}

pub fn add_expense(expenses: &mut HashMap<String, Expense>) {
    println!("Enter expense name (or 'back' to cancel):");
    let name = match get_input() {
        Some(n) => n,
        None => return,
    };

    if let Some(amount) = get_amount_input() {
        expenses.insert(name.clone(), Expense { name, amount });
        println!("Expense added!");
    }
}

pub fn view_expenses(expenses: &HashMap<String, Expense>) {
    if expenses.is_empty() {
        println!("No expenses found.");
        return;
    }
    println!("\nExisting Expenses:");
    for expense in expenses.values() {
        println!("{}: ${:.2}", expense.name, expense.amount);
    }
}

pub fn remove_expense(expenses: &mut HashMap<String, Expense>) {
    println!("Enter expense name to remove (or 'back' to cancel):");
    let name = match get_input() {
        Some(n) => n,
        None => return,
    };

    if expenses.remove(&name).is_some() {
        println!("Expense removed successfully.");
    } else {
        println!("Expense not found.");
    }
}

pub fn edit_expense(expenses: &mut HashMap<String, Expense>) {
    println!("Enter expense name to edit (or 'back' to cancel):");
    let name = match get_input() {
        Some(n) => n,
        None => return,
    };

    if let Some(expense) = expenses.get_mut(&name) {
        println!("Current amount for {}: ${:.2}", expense.name, expense.amount);
        if let Some(amount) = get_amount_input() {
            expense.amount = amount;
            println!("Expense updated successfully!");
        }
    } else {
        println!("Expense not found.");
    }
}
