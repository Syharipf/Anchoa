//! Accounts, transactions and transfers (spec Fase 2). Amounts are integer
//! rupiah; a negative amount is money leaving the account.
//!
//! `crate::report` (new) aggregates these transactions into monthly/yearly recap PDFs;
//! it calls `month_flow`-style queries and `total_balance`, never re-implementing money math.


use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::items;
use crate::time::{day_bounds, month_bounds};

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

pub fn total_balance(accounts: &[AccountView]) -> Result<i64, AppError> {
    let total: i128 = accounts.iter().map(|account| i128::from(account.balance)).sum();
    i64::try_from(total).map_err(|_| invalid("Total saldo di luar batas bilangan bulat"))
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
    list_accounts_before(conn, balance_cutoff(now, tz)?)
}

/// Accounts with balances counting only transactions dated before `cutoff`
/// (epoch ms), e.g. a recap's closing balance at the end of its period.
pub fn list_accounts_before(conn: &Connection, cutoff: i64) -> Result<Vec<AccountView>, AppError> {
    let mut stmt = conn.prepare(&format!("{ACCOUNT_SELECT} ORDER BY i.title COLLATE NOCASE, i.id"))?;
    let rows = stmt.query_map([cutoff], account_from_row)?;
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

// ---------- transactions ----------

pub const EXPENSE_CATEGORIES: [&str; 8] =
    ["Makan & minum", "Transportasi", "Belanja", "Tagihan", "Kesehatan", "Hiburan", "Pendidikan", "Lainnya"];
pub const INCOME_CATEGORIES: [&str; 4] = ["Gaji", "Bonus", "Hadiah", "Lainnya"];
/// Rows per page of `list_transactions`.
pub const PAGE_SIZE: i64 = 50;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionView {
    pub id: String,
    pub title: String,
    pub body: String,
    pub amount: i64,
    pub category: Option<String>,
    pub account_id: String,
    pub account_name: String,
    pub occurred_at: i64,
    pub created_at: i64,
    pub transfer_id: Option<String>,
    pub counter_account_id: Option<String>,
    pub counter_account_name: Option<String>,
    pub bill_id: Option<String>,
    /// Dated after today, so not in the balance yet (spec K4).
    pub scheduled: bool,
}

/// Sets the sign of a plain transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransactionKind {
    #[default]
    Expense,
    Income,
}

/// Filter of "Transaksi terbaru".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Flow {
    All,
    In,
    Out,
}

/// `amount` is always positive; `kind` sets the sign.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionInput {
    pub id: Option<String>,
    pub kind: TransactionKind,
    pub amount: i64,
    pub account_id: String,
    pub occurred_at: i64,
    pub category: Option<String>,
    pub title: String,
    pub body: Option<String>,
}

/// `transfer_id: None` creates a transfer; otherwise both legs are updated.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferInput {
    pub transfer_id: Option<String>,
    pub from_account_id: String,
    pub to_account_id: String,
    pub amount: i64,
    pub occurred_at: i64,
    pub title: Option<String>,
}

/// One page of "Transaksi terbaru".
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionQuery {
    /// `YYYY-MM`: transactions dated before the end of this local month.
    pub until: String,
    pub flow: Flow,
    pub offset: i64,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct TransactionPage {
    pub items: Vec<TransactionView>,
    pub more: bool,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Categories {
    pub expense: Vec<String>,
    pub income: Vec<String>,
}

/// One `transactions` row with its `items` row, for `insert_transaction`.
pub struct NewTransaction<'a> {
    pub title: &'a str,
    pub body: &'a str,
    pub account_id: &'a str,
    pub amount: i64,
    pub category: Option<&'a str>,
    pub occurred_at: i64,
    pub transfer_id: Option<&'a str>,
    pub bill_id: Option<&'a str>,
}

// ?1 = balance cutoff. Both legs of a transfer are written and deleted
// together, so the other leg (t2) of a live transfer is live too.
const TRANSACTION_SELECT: &str = "
    SELECT i.id, i.title, i.body, t.amount, t.category, t.account_id, ai.title,
           t.occurred_at, i.created_at, t.transfer_id, t2.account_id, ci.title, t.bill_id,
           t.occurred_at >= ?1
    FROM transactions t
    JOIN items i ON i.id = t.item_id
    JOIN items ai ON ai.id = t.account_id
    LEFT JOIN transactions t2 ON t2.transfer_id = t.transfer_id AND t2.item_id <> t.item_id
    LEFT JOIN items ci ON ci.id = t2.account_id
    WHERE i.deleted_at IS NULL";

fn transaction_from_row(r: &Row) -> rusqlite::Result<TransactionView> {
    Ok(TransactionView {
        id: r.get(0)?,
        title: r.get(1)?,
        body: r.get(2)?,
        amount: r.get(3)?,
        category: r.get(4)?,
        account_id: r.get(5)?,
        account_name: r.get(6)?,
        occurred_at: r.get(7)?,
        created_at: r.get(8)?,
        transfer_id: r.get(9)?,
        counter_account_id: r.get(10)?,
        counter_account_name: r.get(11)?,
        bill_id: r.get(12)?,
        scheduled: r.get(13)?,
    })
}

pub fn get_transaction(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<TransactionView, AppError> {
    conn.query_row(
        &format!("{TRANSACTION_SELECT} AND i.id = ?2"),
        params![balance_cutoff(now, tz)?, id],
        transaction_from_row,
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

/// Newest first, up to the end of `query.until`. A transfer appears once (its
/// outgoing leg) and only under `all`, since it is neither income nor expense.
pub fn list_transactions(
    conn: &Connection,
    query: &TransactionQuery,
    now: i64,
    tz: &TimeZone,
) -> Result<TransactionPage, AppError> {
    let (_, end) = month_bounds(&query.until, tz)?;
    let flow = match query.flow {
        Flow::All => "(t.transfer_id IS NULL OR t.amount < 0)",
        Flow::In => "t.transfer_id IS NULL AND t.amount > 0",
        Flow::Out => "t.transfer_id IS NULL AND t.amount < 0",
    };
    let sql = format!(
        "{TRANSACTION_SELECT} AND t.occurred_at < ?2 AND {flow}
         ORDER BY t.occurred_at DESC, i.created_at DESC, i.id DESC LIMIT ?3 OFFSET ?4"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params = params![balance_cutoff(now, tz)?, end, PAGE_SIZE + 1, query.offset.max(0)];
    let mut items: Vec<TransactionView> = stmt.query_map(params, transaction_from_row)?.collect::<Result<_, _>>()?;
    let more = items.len() as i64 > PAGE_SIZE;
    items.truncate(PAGE_SIZE as usize);
    Ok(TransactionPage { items, more })
}

/// `Invalid` unless `id` is a live account.
pub fn require_live_account(conn: &Connection, id: &str) -> Result<(), AppError> {
    let live: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM accounts a JOIN items i ON i.id = a.item_id WHERE i.id = ?1 AND i.deleted_at IS NULL)",
        [id],
        |r| r.get(0),
    )?;
    if live { Ok(()) } else { Err(invalid("Akun tidak ditemukan")) }
}

pub fn positive(amount: i64) -> Result<(), AppError> {
    if amount > 0 { Ok(()) } else { Err(invalid("Jumlah harus lebih dari 0")) }
}

fn clean_category(category: Option<&str>) -> Option<String> {
    category.map(str::trim).filter(|c| !c.is_empty()).map(str::to_string)
}

/// Inserts the `items` and `transactions` rows; returns the new id.
pub fn insert_transaction(conn: &Connection, t: &NewTransaction, now: i64) -> Result<String, AppError> {
    let id = items::insert(conn, "transaction", t.title, t.body, now)?;
    conn.execute(
        "INSERT INTO transactions (item_id, account_id, amount, category, occurred_at, transfer_id, bill_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, t.account_id, t.amount, t.category, t.occurred_at, t.transfer_id, t.bill_id],
    )?;
    Ok(id)
}

pub fn save_transaction(
    conn: &Connection,
    input: &TransactionInput,
    now: i64,
    tz: &TimeZone,
) -> Result<TransactionView, AppError> {
    positive(input.amount)?;
    let amount = match input.kind {
        TransactionKind::Expense => -input.amount,
        TransactionKind::Income => input.amount,
    };
    require_live_account(conn, &input.account_id)?;
    let title = input.title.trim();
    let body = input.body.as_deref().unwrap_or("");
    let category = clean_category(input.category.as_deref());

    let tx = conn.unchecked_transaction()?;
    let id = match &input.id {
        None => {
            let row = NewTransaction {
                title,
                body,
                account_id: &input.account_id,
                amount,
                category: category.as_deref(),
                occurred_at: input.occurred_at,
                transfer_id: None,
                bill_id: None,
            };
            insert_transaction(&tx, &row, now)?
        }
        Some(id) => {
            if get_transaction(&tx, id, now, tz)?.transfer_id.is_some() {
                return Err(invalid("Transfer diubah lewat formulir transfer"));
            }
            tx.execute("UPDATE items SET title = ?2, body = ?3, updated_at = ?4 WHERE id = ?1", params![id, title, body, now])?;
            tx.execute(
                "UPDATE transactions SET account_id = ?2, amount = ?3, category = ?4, occurred_at = ?5 WHERE item_id = ?1",
                params![id, input.account_id, amount, category, input.occurred_at],
            )?;
            id.clone()
        }
    };
    tx.commit()?;
    get_transaction(conn, &id, now, tz)
}

/// Creates or updates both legs of a transfer; returns the outgoing leg.
pub fn save_transfer(conn: &Connection, input: &TransferInput, now: i64, tz: &TimeZone) -> Result<TransactionView, AppError> {
    positive(input.amount)?;
    if input.from_account_id == input.to_account_id {
        return Err(invalid("Akun asal dan tujuan harus berbeda"));
    }
    require_live_account(conn, &input.from_account_id)?;
    require_live_account(conn, &input.to_account_id)?;
    let title = input.title.as_deref().map(str::trim).filter(|t| !t.is_empty()).unwrap_or("Transfer");

    let tx = conn.unchecked_transaction()?;
    let out_id = match &input.transfer_id {
        None => {
            let transfer_id = uuid::Uuid::now_v7().to_string();
            let out = NewTransaction {
                title,
                body: "",
                account_id: &input.from_account_id,
                amount: -input.amount,
                category: None,
                occurred_at: input.occurred_at,
                transfer_id: Some(&transfer_id),
                bill_id: None,
            };
            let out_id = insert_transaction(&tx, &out, now)?;
            insert_transaction(&tx, &NewTransaction { account_id: &input.to_account_id, amount: input.amount, ..out }, now)?;
            out_id
        }
        Some(transfer_id) => {
            let (out_leg, in_leg) = transfer_legs(&tx, transfer_id)?.ok_or(AppError::NotFound)?;
            for (id, account, amount) in
                [(&out_leg, &input.from_account_id, -input.amount), (&in_leg, &input.to_account_id, input.amount)]
            {
                tx.execute("UPDATE items SET title = ?2, updated_at = ?3 WHERE id = ?1", params![id, title, now])?;
                tx.execute(
                    "UPDATE transactions SET account_id = ?2, amount = ?3, occurred_at = ?4 WHERE item_id = ?1",
                    params![id, account, amount, input.occurred_at],
                )?;
            }
            out_leg
        }
    };
    tx.commit()?;
    get_transaction(conn, &out_id, now, tz)
}

/// (outgoing leg id, incoming leg id) of a live transfer.
fn transfer_legs(conn: &Connection, transfer_id: &str) -> Result<Option<(String, String)>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT t.item_id, t.amount FROM transactions t JOIN items i ON i.id = t.item_id
         WHERE t.transfer_id = ?1 AND i.deleted_at IS NULL",
    )?;
    let legs: Vec<(String, i64)> = stmt.query_map([transfer_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    let out_leg = legs.iter().find(|(_, amount)| *amount < 0);
    let in_leg = legs.iter().find(|(_, amount)| *amount > 0);
    Ok(match (out_leg, in_leg) {
        (Some((out_id, _)), Some((in_id, _))) if legs.len() == 2 => Some((out_id.clone(), in_id.clone())),
        _ => None,
    })
}

/// Deleting either leg of a transfer deletes both.
pub fn delete_transaction(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<(), AppError> {
    let existing = get_transaction(conn, id, now, tz)?;
    let tx = conn.unchecked_transaction()?;
    match existing.transfer_id {
        Some(transfer_id) => {
            tx.execute(
                "UPDATE items SET deleted_at = ?2
                 WHERE deleted_at IS NULL AND id IN (SELECT item_id FROM transactions WHERE transfer_id = ?1)",
                params![transfer_id, now],
            )?;
        }
        None => {
            items::soft_delete(&tx, id, now)?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Built-in categories first, then any other category already used (spec K6).
pub fn categories(conn: &Connection) -> Result<Categories, AppError> {
    let used = |sign: &str| -> Result<Vec<String>, AppError> {
        let mut stmt = conn.prepare(&format!(
            "SELECT DISTINCT t.category FROM transactions t JOIN items i ON i.id = t.item_id
             WHERE i.deleted_at IS NULL AND t.transfer_id IS NULL AND t.category IS NOT NULL AND t.amount {sign} 0
             ORDER BY t.category COLLATE NOCASE"
        ))?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    };
    let merge = |defaults: &[&str], used: Vec<String>| -> Vec<String> {
        let mut all: Vec<String> = defaults.iter().map(|c| c.to_string()).collect();
        for c in used {
            if !all.contains(&c) {
                all.push(c);
            }
        }
        all
    };
    Ok(Categories { expense: merge(&EXPENSE_CATEGORIES, used("<")?), income: merge(&INCOME_CATEGORIES, used(">")?) })
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

    fn entry(kind: TransactionKind, account_id: &str, amount: i64, category: &str, day: &str) -> TransactionInput {
        TransactionInput {
            kind,
            amount,
            account_id: account_id.into(),
            occurred_at: ms(day),
            category: Some(category.into()),
            title: category.into(),
            ..Default::default()
        }
    }

    pub fn spend(conn: &Connection, account_id: &str, amount: i64, category: &str, day: &str) -> TransactionView {
        let input = entry(TransactionKind::Expense, account_id, amount, category, day);
        save_transaction(conn, &input, now(), &jakarta()).unwrap()
    }

    pub fn earn(conn: &Connection, account_id: &str, amount: i64, day: &str) -> TransactionView {
        let input = entry(TransactionKind::Income, account_id, amount, "Gaji", day);
        save_transaction(conn, &input, now(), &jakarta()).unwrap()
    }

    pub fn transfer(conn: &Connection, from: &str, to: &str, amount: i64, day: &str) -> TransactionView {
        let input =
            TransferInput { from_account_id: from.into(), to_account_id: to.into(), amount, occurred_at: ms(day), ..Default::default() };
        save_transfer(conn, &input, now(), &jakarta()).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;
    use crate::db::open_in_memory;

    const TODAY: &str = "2026-09-29T00:00:00+07:00";

    fn balance(conn: &Connection, id: &str) -> i64 {
        get_account(conn, id, now(), &jakarta()).unwrap().balance
    }

    fn page(conn: &Connection, until: &str, flow: Flow, offset: i64) -> TransactionPage {
        let query = TransactionQuery { until: until.into(), flow, offset };
        list_transactions(conn, &query, now(), &jakarta()).unwrap()
    }

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

    #[test]
    fn balance_counts_live_transactions_up_to_today() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        spend(&conn, &bca, 25_000, "Makan & minum", TODAY);
        earn(&conn, &bca, 500_000, "2026-09-28T00:00:00+07:00");
        let gone = spend(&conn, &bca, 5_000, "Belanja", TODAY);
        delete_transaction(&conn, &gone.id, now(), &jakarta()).unwrap();
        let later = spend(&conn, &bca, 70_000, "Belanja", "2026-09-30T00:00:00+07:00");

        assert!(later.scheduled);
        assert_eq!(balance(&conn, &bca), 1_475_000);
    }

    #[test]
    fn accounts_before_a_cutoff_leave_later_money_out() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        earn(&conn, &bca, 500_000, "2026-08-31T23:59:59.999+07:00");
        spend(&conn, &bca, 25_000, "Belanja", "2026-09-01T00:00:00+07:00");

        let august = list_accounts_before(&conn, ms("2026-09-01T00:00:00+07:00")).unwrap();
        assert_eq!(total_balance(&august).unwrap(), 1_500_000);
        let today = balance_cutoff(now(), &jakarta()).unwrap();
        assert_eq!(list_accounts_before(&conn, today).unwrap(), list_accounts(&conn, now(), &jakarta()).unwrap());
    }

    #[test]
    fn account_with_transactions_cannot_be_deleted() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let t = spend(&conn, &bca, 1_000, "Belanja", TODAY);
        assert!(matches!(delete_account(&conn, &bca, now(), &jakarta()), Err(AppError::AccountInUse)));

        delete_transaction(&conn, &t.id, now(), &jakarta()).unwrap();
        delete_account(&conn, &bca, now(), &jakarta()).unwrap();
    }

    #[test]
    fn transaction_input_is_validated() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let base = || TransactionInput { amount: 1_000, account_id: bca.clone(), title: "x".into(), ..Default::default() };
        for bad in [
            TransactionInput { amount: 0, ..base() },
            TransactionInput { amount: -5, ..base() },
            TransactionInput { account_id: "nope".into(), ..base() },
        ] {
            assert!(matches!(save_transaction(&conn, &bad, now(), &jakarta()), Err(AppError::Invalid(_))));
        }
    }

    #[test]
    fn saving_with_an_id_updates_the_transaction() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let t = spend(&conn, &bca, 1_000, "Belanja", TODAY);
        let input = TransactionInput {
            id: Some(t.id.clone()),
            kind: TransactionKind::Income,
            amount: 7_000,
            account_id: bca.clone(),
            occurred_at: t.occurred_at,
            category: Some("  ".into()),
            title: " bonus ".into(),
            body: Some("catatan".into()),
        };

        let updated = save_transaction(&conn, &input, now(), &jakarta()).unwrap();

        assert_eq!(updated.id, t.id);
        assert_eq!(
            (updated.amount, updated.category.clone(), updated.title.as_str(), updated.body.as_str()),
            (7_000, None, "bonus", "catatan")
        );
        assert_eq!(balance(&conn, &bca), 7_000);
    }

    #[test]
    fn transfer_moves_money_between_accounts() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        let gopay = account(&conn, "GoPay", 0);

        let out = transfer(&conn, &bca, &gopay, 100_000, TODAY);

        assert_eq!((out.amount, out.title.as_str(), out.category.clone()), (-100_000, "Transfer", None));
        assert_eq!(
            (out.counter_account_id.as_deref(), out.counter_account_name.as_deref()),
            (Some(gopay.as_str()), Some("GoPay"))
        );
        assert_eq!((balance(&conn, &bca), balance(&conn, &gopay)), (900_000, 100_000));
        let listed: Vec<String> = page(&conn, "2026-09", Flow::All, 0).items.into_iter().map(|t| t.id).collect();
        assert_eq!(listed, [out.id.as_str()], "a transfer is listed once, by its outgoing leg");
        assert!(page(&conn, "2026-09", Flow::In, 0).items.is_empty());
        assert!(page(&conn, "2026-09", Flow::Out, 0).items.is_empty());
    }

    #[test]
    fn transfer_edit_and_delete_touch_both_legs() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        let gopay = account(&conn, "GoPay", 0);
        let out = transfer(&conn, &bca, &gopay, 100_000, TODAY);
        let edit = TransferInput {
            transfer_id: out.transfer_id.clone(),
            from_account_id: bca.clone(),
            to_account_id: gopay.clone(),
            amount: 40_000,
            occurred_at: out.occurred_at,
            title: Some("isi saldo".into()),
        };

        let edited = save_transfer(&conn, &edit, now(), &jakarta()).unwrap();

        assert_eq!((edited.id.as_str(), edited.title.as_str()), (out.id.as_str(), "isi saldo"));
        assert_eq!((balance(&conn, &bca), balance(&conn, &gopay)), (960_000, 40_000));
        let plain_edit = TransactionInput { id: Some(out.id.clone()), amount: 1, account_id: bca.clone(), ..Default::default() };
        assert!(matches!(save_transaction(&conn, &plain_edit, now(), &jakarta()), Err(AppError::Invalid(_))));

        delete_transaction(&conn, &out.id, now(), &jakarta()).unwrap();
        assert_eq!((balance(&conn, &bca), balance(&conn, &gopay)), (1_000_000, 0));
    }

    #[test]
    fn transfer_input_is_validated() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let same = TransferInput { from_account_id: bca.clone(), to_account_id: bca.clone(), amount: 1, ..Default::default() };
        assert!(matches!(save_transfer(&conn, &same, now(), &jakarta()), Err(AppError::Invalid(_))));
        let ghost = TransferInput { from_account_id: bca.clone(), to_account_id: "nope".into(), amount: 1, ..Default::default() };
        assert!(matches!(save_transfer(&conn, &ghost, now(), &jakarta()), Err(AppError::Invalid(_))));
    }

    #[test]
    fn list_filters_by_flow_up_to_the_end_of_the_month() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        spend(&conn, &bca, 7_000, "Belanja", "2026-08-31T00:00:00+07:00");
        earn(&conn, &bca, 500_000, "2026-09-28T00:00:00+07:00");
        spend(&conn, &bca, 25_000, "Makan & minum", TODAY);
        spend(&conn, &bca, 99_000, "Belanja", "2026-10-01T00:00:00+07:00");

        let amounts = |flow: Flow| page(&conn, "2026-09", flow, 0).items.iter().map(|t| t.amount).collect::<Vec<_>>();

        assert_eq!(amounts(Flow::All), [-25_000, 500_000, -7_000]);
        assert_eq!(amounts(Flow::In), [500_000]);
        assert_eq!(amounts(Flow::Out), [-25_000, -7_000]);
        let bad_month = TransactionQuery { until: "2026-13".into(), flow: Flow::All, offset: 0 };
        assert!(matches!(list_transactions(&conn, &bad_month, now(), &jakarta()), Err(AppError::Invalid(_))));
    }

    #[test]
    fn wire_names_match_the_frontend() {
        let input: TransactionInput =
            serde_json::from_str(r#"{"kind":"income","amount":1,"accountId":"a","occurredAt":0,"title":""}"#).unwrap();
        assert_eq!(input.kind, TransactionKind::Income);
        let query: TransactionQuery = serde_json::from_str(r#"{"until":"2026-09","flow":"out","offset":0}"#).unwrap();
        assert_eq!(query.flow, Flow::Out);
        assert!(serde_json::from_str::<TransactionQuery>(r#"{"until":"2026-09","flow":"x","offset":0}"#).is_err());
    }

    #[test]
    fn list_pages_by_fifty() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        for _ in 0..51 {
            spend(&conn, &bca, 1_000, "Belanja", TODAY);
        }

        let first = page(&conn, "2026-09", Flow::All, 0);
        let rest = page(&conn, "2026-09", Flow::All, 50);

        assert_eq!((first.items.len(), first.more), (50, true));
        assert_eq!((rest.items.len(), rest.more), (1, false));
        assert!(!first.items.iter().any(|t| t.id == rest.items[0].id));
    }

    #[test]
    fn categories_merge_defaults_with_used_ones() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        spend(&conn, &bca, 1_000, "Kopi", TODAY);
        spend(&conn, &bca, 1_000, "Belanja", TODAY);

        let c = categories(&conn).unwrap();

        assert_eq!(c.expense.len(), EXPENSE_CATEGORIES.len() + 1);
        assert_eq!(c.expense.last().map(String::as_str), Some("Kopi"));
        assert_eq!(c.income, INCOME_CATEGORIES.map(String::from).to_vec());
    }

    #[test]
    fn deleted_transactions_disappear_from_every_flow_and_custom_categories() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let live = spend(&conn, &bca, 1, "Kopi", TODAY);
        let expense = spend(&conn, &bca, 99, "Kategori dihapus", TODAY);
        let income = earn(&conn, &bca, 100, TODAY);
        conn.execute("UPDATE transactions SET category = 'Bonus dihapus' WHERE item_id = ?1", [&income.id]).unwrap();
        for id in [&expense.id, &income.id] {
            delete_transaction(&conn, id, now(), &jakarta()).unwrap();
            assert!(matches!(get_transaction(&conn, id, now(), &jakarta()), Err(AppError::NotFound)));
        }
        for flow in [Flow::All, Flow::Out] {
            assert_eq!(page(&conn, "2026-09", flow, 0).items.as_slice(), std::slice::from_ref(&live));
        }
        assert!(page(&conn, "2026-09", Flow::In, 0).items.is_empty());
        let categories = categories(&conn).unwrap();
        assert!(!categories.expense.contains(&"Kategori dihapus".into()));
        assert!(!categories.income.contains(&"Bonus dihapus".into()));
    }

    #[test]
    fn deleted_accounts_and_transfers_cannot_be_reused_or_edited() {
        let conn = open_in_memory();
        let from = account(&conn, "BCA", 0);
        let to = account(&conn, "GoPay", 0);
        let out = transfer(&conn, &from, &to, 1, TODAY);
        let incoming = transfer_legs(&conn, out.transfer_id.as_deref().unwrap()).unwrap().unwrap().1;
        delete_transaction(&conn, &incoming, now(), &jakarta()).unwrap();
        assert!(page(&conn, "2026-09", Flow::All, 0).items.is_empty());
        let edit = TransferInput { transfer_id: out.transfer_id, from_account_id: from.clone(), to_account_id: to.clone(), amount: 1, ..Default::default() };
        assert!(matches!(save_transfer(&conn, &edit, now(), &jakarta()), Err(AppError::NotFound)));
        delete_account(&conn, &to, now(), &jakarta()).unwrap();
        assert!(matches!(get_account(&conn, &to, now(), &jakarta()), Err(AppError::NotFound)));
        assert!(matches!(require_live_account(&conn, &to), Err(AppError::Invalid(_))));
        let edit = AccountInput { id: Some(to.clone()), name: "GoPay".into(), kind: "bank".into(), ..Default::default() };
        assert!(matches!(save_account(&conn, &edit, now(), &jakarta()), Err(AppError::NotFound)));
        let input = TransactionInput { account_id: to, amount: 1, ..Default::default() };
        assert!(matches!(save_transaction(&conn, &input, now(), &jakarta()), Err(AppError::Invalid(_))));
        assert_eq!(list_accounts(&conn, now(), &jakarta()).unwrap().len(), 1);
    }

    #[test]
    fn scheduled_money_enters_the_balance_at_jakarta_midnight() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 10);
        let last = earn(&conn, &bca, 1, "2026-09-29T23:59:59.999+07:00");
        let next = earn(&conn, &bca, 2, "2026-09-30T00:00:00+07:00");
        let midnight = next.occurred_at;
        assert_eq!(get_account(&conn, &bca, midnight - 1, &jakarta()).unwrap().balance, 11);
        assert!(!get_transaction(&conn, &last.id, midnight - 1, &jakarta()).unwrap().scheduled);
        assert!(get_transaction(&conn, &next.id, midnight - 1, &jakarta()).unwrap().scheduled);
        assert_eq!(get_account(&conn, &bca, midnight, &jakarta()).unwrap().balance, 13);
        assert!(!get_transaction(&conn, &next.id, midnight, &jakarta()).unwrap().scheduled);
    }

    #[test]
    fn integer_money_survives_json_storage_transfers_and_aggregation() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let cash = account(&conn, "Tunai", 0);
        let amount = 9_007_199_254_740_991_i64; // Largest exact integer in the frontend.
        let input: TransactionInput = serde_json::from_value(serde_json::json!({
            "kind": "income", "amount": amount, "accountId": bca, "occurredAt": ms(TODAY), "title": "Gaji"
        })).unwrap();
        let saved = save_transaction(&conn, &input, now(), &jakarta()).unwrap();
        assert_eq!(serde_json::to_value(&saved).unwrap()["amount"].as_i64(), Some(amount));
        let stored: (i64, String) = conn.query_row("SELECT amount, typeof(amount) FROM transactions WHERE item_id = ?1", [&saved.id], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
        assert_eq!(stored, (amount, "integer".into()));
        transfer(&conn, &bca, &cash, 1, TODAY);
        spend(&conn, &cash, 1, "Kopi", TODAY);
        assert_eq!((balance(&conn, &bca), balance(&conn, &cash)), (amount - 1, 0));
        let overview = crate::overview::overview(&conn, None, now(), &jakarta()).unwrap();
        assert_eq!((overview.income, overview.expense, overview.net, overview.balance), (amount, 1, amount - 1, amount - 1));
        for bad in [serde_json::json!(1.5), serde_json::json!("1"), serde_json::json!(null)] {
            let mut json = serde_json::to_value(&saved).unwrap();
            json["kind"] = serde_json::json!("income");
            json["amount"] = bad;
            assert!(serde_json::from_value::<TransactionInput>(json).is_err());
        }
    }
}
