#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

#[contracttype]
pub enum DataKey {
    Admin,
    Student(Address),
    Payments(Address),
}

#[contracttype]
#[derive(Clone)]
pub struct Payment {
    pub amount: i128,
    pub description: String,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct Student {
    pub name: String,
    pub class: String,
    pub address: Address,
}

#[contract]
pub struct SchoolManagement;

#[contractimpl]
impl SchoolManagement {
    pub fn __constructor(e: Env, admin: Address) {
        e.storage().instance().set(&DataKey::Admin, &admin);
    }

    fn admin(e: &Env) -> Address {
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        admin
    }

    pub fn register_student(e: Env, student: Address, name: String, class: String) {
        Self::admin(&e);

        e.storage().persistent().set(
            &DataKey::Student(student.clone()),
            &Student { name, class, address: student.clone() },
        );

        let payments: Vec<Payment> = Vec::new(&e);
        e.storage().persistent().set(&DataKey::Payments(student), &payments);
    }

    pub fn get_student(e: Env, student: Address) -> Student {
        e.storage()
            .persistent()
            .get(&DataKey::Student(student))
            .expect("student not found")
    }

    pub fn update_student_class(e: Env, student: Address, new_class: String) {
        Self::admin(&e);

        let mut record: Student = e
            .storage()
            .persistent()
            .get(&DataKey::Student(student.clone()))
            .expect("student not found");

        record.class = new_class;
        e.storage().persistent().set(&DataKey::Student(student), &record);
    }

    pub fn get_payment_history(e: Env, student: Address) -> Vec<Payment> {
        e.storage()
            .persistent()
            .get(&DataKey::Payments(student))
            .unwrap_or(Vec::new(&e))
    }

    pub fn remove_student(e: Env, student: Address) {
        Self::admin(&e);

        if !e.storage().persistent().has(&DataKey::Student(student.clone())) {
            panic!("student not found");
        }

        e.storage().persistent().remove(&DataKey::Student(student.clone()));
        e.storage().persistent().remove(&DataKey::Payments(student));
    }

    pub fn add_payment(e: Env, student: Address, amount: i128, description: String) {
        Self::admin(&e);

        if amount <= 0 {
            panic!("amount must be positive");
        }

        if !e.storage().persistent().has(&DataKey::Student(student.clone())) {
            panic!("student not found");
        }

        let mut history: Vec<Payment> = e
            .storage()
            .persistent()
            .get(&DataKey::Payments(student.clone()))
            .unwrap_or(Vec::new(&e));

        history.push_back(Payment {
            amount,
            description,
            ledger: e.ledger().sequence(),
        });

        e.storage().persistent().set(&DataKey::Payments(student), &history);
    }
}

mod test;
