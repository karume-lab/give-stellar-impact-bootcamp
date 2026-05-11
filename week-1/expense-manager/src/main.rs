mod cli;
mod expenses;

use std::collections::HashMap;
use std::io::{self, Write};
use crate::expenses::{Expense, add_expense, view_expenses, remove_expense, edit_expense};
use crate::cli::get_input;

fn main() {
    let mut expenses: HashMap<String, Expense> = HashMap::new();

    loop {
        println!("\n--- Interactive Expense Manager ---");
        println!("1. Add Expense");
        println!("2. View Expenses");
        println!("3. Remove Expense");
        println!("4. Edit Expense");
        println!("5. Exit");
        print!("Choose an option: ");
        io::stdout().flush().expect("Failed to flush stdout");

        let choice = match get_input() {
            Some(c) => c,
            None => continue,
        };

        match choice.as_str() {
            "1" => add_expense(&mut expenses),
            "2" => view_expenses(&expenses),
            "3" => remove_expense(&mut expenses),
            "4" => edit_expense(&mut expenses),
            "5" => {
                println!("Exiting application... Goodbye!");
                break;
            }
            _ => println!("Invalid selection. Please choose 1-5."),
        }
    }
}
