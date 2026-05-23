#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup(e: &Env) -> (SchoolManagementClient<'_>, Address) {
    let admin = Address::generate(e);
    let contract = e.register(SchoolManagement, (&admin,));
    (SchoolManagementClient::new(e, &contract), admin)
}

#[test]
fn test_update_student_class() {
    let e = Env::default();
    e.mock_all_auths();

    let (client, _) = setup(&e);
    let student = Address::generate(&e);

    client.register_student(
        &student,
        &String::from_str(&e, "Alice"),
        &String::from_str(&e, "Grade 4"),
    );

    client.update_student_class(&student, &String::from_str(&e, "Grade 5"));

    let record = client.get_student(&student);
    assert_eq!(record.class, String::from_str(&e, "Grade 5"));
    assert_eq!(record.name, String::from_str(&e, "Alice"));
}

#[test]
fn test_get_payment_history() {
    let e = Env::default();
    e.mock_all_auths();

    let (client, _) = setup(&e);
    let student = Address::generate(&e);

    client.register_student(
        &student,
        &String::from_str(&e, "Bob"),
        &String::from_str(&e, "Grade 6"),
    );

    assert_eq!(client.get_payment_history(&student).len(), 0);

    client.add_payment(&student, &500, &String::from_str(&e, "Term 1 fees"));
    client.add_payment(&student, &750, &String::from_str(&e, "Term 2 fees"));

    let history = client.get_payment_history(&student);
    assert_eq!(history.len(), 2);
    assert_eq!(history.get(0).unwrap().amount, 500);
    assert_eq!(history.get(1).unwrap().amount, 750);
}

#[test]
fn test_remove_student() {
    let e = Env::default();
    e.mock_all_auths();

    let (client, _) = setup(&e);
    let student = Address::generate(&e);

    client.register_student(
        &student,
        &String::from_str(&e, "Carol"),
        &String::from_str(&e, "Grade 3"),
    );

    client.add_payment(&student, &200, &String::from_str(&e, "Registration"));
    client.remove_student(&student);

    // payment history should be cleared
    assert_eq!(client.get_payment_history(&student).len(), 0);
}

#[test]
#[should_panic(expected = "student not found")]
fn test_remove_student_not_found() {
    let e = Env::default();
    e.mock_all_auths();

    let (client, _) = setup(&e);
    client.remove_student(&Address::generate(&e));
}

#[test]
#[should_panic(expected = "student not found")]
fn test_get_student_after_remove() {
    let e = Env::default();
    e.mock_all_auths();

    let (client, _) = setup(&e);
    let student = Address::generate(&e);

    client.register_student(
        &student,
        &String::from_str(&e, "Dave"),
        &String::from_str(&e, "Grade 2"),
    );

    client.remove_student(&student);
    client.get_student(&student);
}
