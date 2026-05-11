use std::io;

pub fn get_input() -> Option<String> {
    let mut buffer = String::new();
    io::stdin().read_line(&mut buffer).expect("Failed to read line");
    let input = buffer.trim().to_string();
    if input.is_empty() || input.to_lowercase() == "back" {
        None
    } else {
        Some(input)
    }
}

pub fn get_amount_input() -> Option<f64> {
    loop {
        println!("Enter amount (or 'back' to cancel):");
        let input = match get_input() {
            Some(i) => i,
            None => return None,
        };
        match input.parse::<f64>() {
            Ok(num) => return Some(num),
            Err(_) => println!("Invalid input. Please enter a valid number."),
        }
    }
}
