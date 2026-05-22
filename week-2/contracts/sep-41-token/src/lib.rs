#![no_std]
#![allow(deprecated)]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token::TokenInterface, Address, Env,
    MuxedAddress, String,
};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AllowanceKey {
    pub from: Address,
    pub spender: Address,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum DataKey {
    Admin,
    Name,
    Symbol,
    Decimals,
    Balance(Address),
    Allowance(AllowanceKey),
}

#[contract]
pub struct Token;

#[contractimpl]
impl Token {
    pub fn __constructor(
        e: Env,
        admin: Address,
        decimal: u32,
        name: String,
        symbol: String,
        initial_mint: i128,
    ) {
        if decimal > 18 {
            panic!("Decimal must not be greater than 18");
        }
        if initial_mint < 0 {
            panic!("initial mint amount must be non-negative");
        }

        e.storage().instance().set(&DataKey::Admin, &admin);
        e.storage().instance().set(&DataKey::Decimals, &decimal);
        e.storage().instance().set(&DataKey::Name, &name);
        e.storage().instance().set(&DataKey::Symbol, &symbol);

        if initial_mint > 0 {
            e.storage().persistent().set(&DataKey::Balance(admin.clone()), &initial_mint);
            e.events().publish(
                (symbol_short!("mint"), admin),
                initial_mint,
            );
        }
    }

    pub fn mint(e: Env, to: Address, amount: i128) {
        if amount < 0 {
            panic!("negative amount is not allowed");
        }
        let admin: Address = e.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let balance = Self::read_balance(&e, &to);
        e.storage().persistent().set(&DataKey::Balance(to.clone()), &(balance + amount));

        e.events().publish(
            (symbol_short!("mint"), to),
            amount,
        );
    }

    #[cfg(test)]
    pub fn get_allowance(e: Env, from: Address, spender: Address) -> Option<AllowanceValue> {
        let key = DataKey::Allowance(AllowanceKey { from, spender });
        e.storage().temporary().get::<_, AllowanceValue>(&key)
    }

    fn read_balance(e: &Env, id: &Address) -> i128 {
        e.storage().persistent().get(&DataKey::Balance(id.clone())).unwrap_or(0)
    }

    fn read_allowance(e: &Env, from: &Address, spender: &Address) -> AllowanceValue {
        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        if let Some(allowance) = e.storage().temporary().get::<_, AllowanceValue>(&key) {
            if allowance.expiration_ledger < e.ledger().sequence() {
                AllowanceValue { amount: 0, expiration_ledger: allowance.expiration_ledger }
            } else {
                allowance
            }
        } else {
            AllowanceValue { amount: 0, expiration_ledger: 0 }
        }
    }
}

#[contractimpl]
impl TokenInterface for Token {
    fn allowance(e: Env, from: Address, spender: Address) -> i128 {
        Self::read_allowance(&e, &from, &spender).amount
    }

    fn approve(e: Env, from: Address, spender: Address, amount: i128, expiration_ledger: u32) {
        from.require_auth();
        if amount < 0 {
            panic!("negative amount is not allowed");
        }

        if amount > 0 && expiration_ledger < e.ledger().sequence() {
            panic!("expiration_ledger is less than current ledger sequence");
        }

        let key = DataKey::Allowance(AllowanceKey {
            from: from.clone(),
            spender: spender.clone(),
        });
        let val = AllowanceValue {
            amount,
            expiration_ledger,
        };
        e.storage().temporary().set(&key, &val);

        if amount > 0 {
            let live_for = expiration_ledger
                .checked_sub(e.ledger().sequence())
                .unwrap();
            e.storage().temporary().extend_ttl(&key, live_for, live_for);
        }

        e.events().publish(
            (symbol_short!("approve"), from, spender),
            amount,
        );
    }

    fn balance(e: Env, id: Address) -> i128 {
        Self::read_balance(&e, &id)
    }

    fn transfer(e: Env, from: Address, to_muxed: MuxedAddress, amount: i128) {
        from.require_auth();
        if amount < 0 {
            panic!("negative amount is not allowed");
        }

        let from_balance = Self::read_balance(&e, &from);
        if from_balance < amount {
            panic!("insufficient balance");
        }

        e.storage().persistent().set(&DataKey::Balance(from.clone()), &(from_balance - amount));

        let to = to_muxed.address();
        let to_balance = Self::read_balance(&e, &to);
        e.storage().persistent().set(&DataKey::Balance(to.clone()), &(to_balance + amount));

        e.events().publish(
            (symbol_short!("transfer"), from, to),
            amount,
        );
    }

    fn transfer_from(e: Env, spender: Address, from: Address, to: Address, amount: i128) {
        spender.require_auth();
        if amount < 0 {
            panic!("negative amount is not allowed");
        }

        let allowance = Self::read_allowance(&e, &from, &spender);
        if allowance.amount < amount {
            panic!("insufficient allowance");
        }

        let from_balance = Self::read_balance(&e, &from);
        if from_balance < amount {
            panic!("insufficient balance");
        }

        if amount > 0 {
            let key = DataKey::Allowance(AllowanceKey {
                from: from.clone(),
                spender: spender.clone(),
            });
            let new_allowance = AllowanceValue {
                amount: allowance.amount - amount,
                expiration_ledger: allowance.expiration_ledger,
            };
            e.storage().temporary().set(&key, &new_allowance);
        }

        e.storage().persistent().set(&DataKey::Balance(from.clone()), &(from_balance - amount));

        let to_balance = Self::read_balance(&e, &to);
        e.storage().persistent().set(&DataKey::Balance(to.clone()), &(to_balance + amount));

        e.events().publish(
            (symbol_short!("transfer"), from, to),
            amount,
        );
    }

    fn burn(e: Env, from: Address, amount: i128) {
        from.require_auth();
        if amount < 0 {
            panic!("negative amount is not allowed");
        }

        let from_balance = Self::read_balance(&e, &from);
        if from_balance < amount {
            panic!("insufficient balance");
        }

        e.storage().persistent().set(&DataKey::Balance(from.clone()), &(from_balance - amount));

        e.events().publish(
            (symbol_short!("burn"), from),
            amount,
        );
    }

    fn burn_from(e: Env, spender: Address, from: Address, amount: i128) {
        spender.require_auth();
        if amount < 0 {
            panic!("negative amount is not allowed");
        }

        let allowance = Self::read_allowance(&e, &from, &spender);
        if allowance.amount < amount {
            panic!("insufficient allowance");
        }

        let from_balance = Self::read_balance(&e, &from);
        if from_balance < amount {
            panic!("insufficient balance");
        }

        if amount > 0 {
            let key = DataKey::Allowance(AllowanceKey {
                from: from.clone(),
                spender: spender.clone(),
            });
            let new_allowance = AllowanceValue {
                amount: allowance.amount - amount,
                expiration_ledger: allowance.expiration_ledger,
            };
            e.storage().temporary().set(&key, &new_allowance);
        }

        e.storage().persistent().set(&DataKey::Balance(from.clone()), &(from_balance - amount));

        e.events().publish(
            (symbol_short!("burn"), from),
            amount,
        );
    }

    fn decimals(e: Env) -> u32 {
        e.storage().instance().get(&DataKey::Decimals).unwrap()
    }

    fn name(e: Env) -> String {
        e.storage().instance().get(&DataKey::Name).unwrap()
    }

    fn symbol(e: Env) -> String {
        e.storage().instance().get(&DataKey::Symbol).unwrap()
    }
}

mod test;
