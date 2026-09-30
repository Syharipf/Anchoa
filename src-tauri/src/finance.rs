//! Accounts, transactions and transfers (spec Fase 2). Amounts are integer
//! rupiah; a negative amount is money leaving the account.
use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::items;
use crate::time::day_bounds;

pub const ACCOUNT_KINDS: [&str; 4] = ["cash", "bank", "ewallet", "credit"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub currency: String,
    pub opening_balance: i64,
    pub balance: i64,
}

/// `id: None` creates an account; otherwise that account is updated.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: String,
    pub opening_balance: i64,
}

pub fn invalid(message: &str) -> AppError {
    AppError::Invalid(message.to_string())
}

/// Balances count transactions dated before this: the start of tomorrow (spec K4).
pub fn balance_cutoff(now: i64, tz: &TimeZone) -> Result<i64, AppError> {
    Ok(day_bounds(now, tz)?.1)
}

// ---------- accounts ----------

// ?1 = balance cutoff
const ACCOUNT_SELECT: &str = "
    SELECT i.id, i.title, a.kind, a.currency, a.opening_balance,
           a.opening_balance + COALESCE((
               SELECT SUM(t.amount) FROM transactions t JOIN items ti ON ti.id = t.item_id
               WHERE t.account_id = i.id AND ti.deleted_at IS NULL AND t.occurred_at < ?1), 0)
    FROM accounts a JOIN items i ON i.id = a.item_id
    WHERE i.deleted_at IS NULL";

fn account_from_row(r: &Row) -> rusqlite::Result<AccountView> {
    Ok(AccountView {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        currency: r.get(3)?,
        opening_balance: r.get(4)?,
        balance: r.get(5)?,
    })
}

fn account_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("Nama akun tidak boleh kosong"));
    }
    Ok(name.to_string())
}

pub fn list_accounts(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Vec<AccountView>, AppError> {
    let mut stmt = conn.prepare(&format!("{ACCOUNT_SELECT} ORDER BY i.title COLLATE NOCASE, i.id"))?;
    let rows = stmt.query_map([balance_cutoff(now, tz)?], account_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_account(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<AccountView, AppError> {
    conn.query_row(&format!("{ACCOUNT_SELECT} AND i.id = ?2"), params![balance_cutoff(now, tz)?, id], account_from_row)
        .optional()?
        .ok_or(AppError::NotFound)
}

pub fn save_account(conn: &Connection, input: &AccountInput, now: i64, tz: &TimeZone) -> Result<AccountView, AppError> {
    let name = account_name(&input.name)?;
    if !ACCOUNT_KINDS.contains(&input.kind.as_str()) {
        return Err(invalid("Jenis akun tidak dikenal"));
    }
    let tx = conn.unchecked_transaction()?;
    let id = match &input.id {
        None => {
            let id = items::insert(&tx, "account", &name, "", now)?;
            tx.execute(
                "INSERT INTO accounts (item_id, kind, opening_balance) VALUES (?1, ?2, ?3)",
                params![id, input.kind, input.opening_balance],
            )?;
            id
        }
        Some(id) => {
            get_account(&tx, id, now, tz)?;
            tx.execute("UPDATE items SET title = ?2, updated_at = ?3 WHERE id = ?1", params![id, name, now])?;
            tx.execute(
                "UPDATE accounts SET kind = ?2, opening_balance = ?3 WHERE item_id = ?1",
                params![id, input.kind, input.opening_balance],
            )?;
            id.clone()
        }
    };
    tx.commit()?;
    get_account(conn, &id, now, tz)
}

/// Refused with `AccountInUse` while a live transaction or an unfinished bill uses it (spec K8).
pub fn delete_account(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<(), AppError> {
    get_account(conn, id, now, tz)?;
    let in_use: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM transactions t JOIN items i ON i.id = t.item_id
                        WHERE t.account_id = ?1 AND i.deleted_at IS NULL)
             OR EXISTS (SELECT 1 FROM bills b JOIN items i ON i.id = b.item_id
                        WHERE b.account_id = ?1 AND i.deleted_at IS NULL AND i.completed_at IS NULL)",
        [id],
        |r| r.get(0),
    )?;
    if in_use {
        return Err(AppError::AccountInUse);
    }
    items::soft_delete(conn, id, now)?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod testing {
    //! Helpers shared by the finance, overview, bills and dashboard tests.
    use super::*;
    use jiff::Timestamp;

    pub fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    pub fn jakarta() -> TimeZone {
        TimeZone::fixed(jiff::tz::offset(7))
    }

    /// "Now" in every finance test: Tuesday 29 Sep 2026, 12:00 in Jakarta.
    pub fn now() -> i64 {
        ms("2026-09-29T12:00:00+07:00")
    }

    pub fn account(conn: &Connection, name: &str, opening: i64) -> String {
        let input = AccountInput { name: name.into(), kind: "bank".into(), opening_balance: opening, ..Default::default() };
        save_account(conn, &input, now(), &jakarta()).unwrap().id
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn new_account_starts_at_its_opening_balance() {
        let conn = open_in_memory();
        let bca = account(&conn, "  BCA ", 1_000_000);
        let view = get_account(&conn, &bca, now(), &jakarta()).unwrap();
        assert_eq!(
            (view.name.as_str(), view.kind.as_str(), view.currency.as_str(), view.balance),
            ("BCA", "bank", "IDR", 1_000_000)
        );
        let kind: String = conn.query_row("SELECT type FROM items WHERE id = ?1", [&bca], |r| r.get(0)).unwrap();
        assert_eq!(kind, "account");
    }

    #[test]
    fn account_input_is_validated() {
        let conn = open_in_memory();
        let blank = AccountInput { name: "  ".into(), kind: "bank".into(), ..Default::default() };
        assert!(matches!(save_account(&conn, &blank, now(), &jakarta()), Err(AppError::Invalid(_))));
        let odd = AccountInput { name: "X".into(), kind: "crypto".into(), ..Default::default() };
        assert!(matches!(save_account(&conn, &odd, now(), &jakarta()), Err(AppError::Invalid(_))));
        assert!(list_accounts(&conn, now(), &jakarta()).unwrap().is_empty());
    }

    #[test]
    fn saving_with_an_id_updates_and_lists_by_name() {
        let conn = open_in_memory();
        let gopay = account(&conn, "gopay", 0);
        account(&conn, "BCA", 0);
        let input =
            AccountInput { id: Some(gopay.clone()), name: "GoPay".into(), kind: "ewallet".into(), opening_balance: -50_000 };

        let updated = save_account(&conn, &input, now(), &jakarta()).unwrap();

        assert_eq!(
            (updated.id.as_str(), updated.name.as_str(), updated.kind.as_str(), updated.balance),
            (gopay.as_str(), "GoPay", "ewallet", -50_000)
        );
        let names: Vec<String> = list_accounts(&conn, now(), &jakarta()).unwrap().into_iter().map(|a| a.name).collect();
        assert_eq!(names, ["BCA", "GoPay"]);
    }

    #[test]
    fn unknown_account_is_not_found() {
        let conn = open_in_memory();
        let input = AccountInput { id: Some("nope".into()), name: "X".into(), kind: "bank".into(), ..Default::default() };
        assert!(matches!(save_account(&conn, &input, now(), &jakarta()), Err(AppError::NotFound)));
        assert!(matches!(delete_account(&conn, "nope", now(), &jakarta()), Err(AppError::NotFound)));
    }

    #[test]
    fn unused_account_can_be_deleted_once() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        delete_account(&conn, &bca, now(), &jakarta()).unwrap();
        assert!(list_accounts(&conn, now(), &jakarta()).unwrap().is_empty());
        assert!(matches!(delete_account(&conn, &bca, now(), &jakarta()), Err(AppError::NotFound)));
    }
}
