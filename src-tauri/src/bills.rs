//! Bills, once or monthly, paid with one click (spec Fase 2 K10).
use jiff::tz::TimeZone;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::finance::{self, NewTransaction, TransactionView, invalid};
use crate::items;
use crate::time::{day_bounds, local_date, next_month_due};

/// Category of the expense that "Tandai lunas" records.
pub const BILL_CATEGORY: &str = "Tagihan";

/// A bill's state today. Once bills paid before today are finished and never sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BillStatus {
    Overdue,
    DueToday,
    Upcoming,
    PaidToday,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Repeat {
    Once,
    #[default]
    Monthly,
}

/// Stored as `once` or `monthly`, the same words as in JSON.
impl ToSql for Repeat {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            Repeat::Once => "once",
            Repeat::Monthly => "monthly",
        }
        .into())
    }
}

impl FromSql for Repeat {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "once" => Ok(Repeat::Once),
            "monthly" => Ok(Repeat::Monthly),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillView {
    pub id: String,
    pub name: String,
    pub amount: i64,
    pub account_id: String,
    pub account_name: String,
    pub repeat: Repeat,
    pub due_at: i64,
    pub status: BillStatus,
    /// Local days since `due_at` when overdue, else 0.
    pub days_late: i64,
}

/// `id: None` creates a bill; otherwise that bill is updated.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillInput {
    pub id: Option<String>,
    pub name: String,
    pub amount: i64,
    pub account_id: String,
    pub repeat: Repeat,
    pub due_at: i64,
}

/// A bill row before its status is worked out.
struct Raw {
    view: BillView,
    completed_at: Option<i64>,
    paid_today: bool,
}

// ?1, ?2 = start and end of today
const BILL_SELECT: &str = "
    SELECT i.id, i.title, b.amount, b.account_id, ai.title, b.repeat, i.due_at, i.completed_at,
           EXISTS (SELECT 1 FROM transactions t JOIN items ti ON ti.id = t.item_id
                   WHERE t.bill_id = i.id AND ti.deleted_at IS NULL AND ti.created_at >= ?1 AND ti.created_at < ?2)
    FROM bills b
    JOIN items i ON i.id = b.item_id
    JOIN items ai ON ai.id = b.account_id
    WHERE i.deleted_at IS NULL";

fn raw_from_row(r: &Row) -> rusqlite::Result<Raw> {
    Ok(Raw {
        view: BillView {
            id: r.get(0)?,
            name: r.get(1)?,
            amount: r.get(2)?,
            account_id: r.get(3)?,
            account_name: r.get(4)?,
            repeat: r.get(5)?,
            due_at: r.get(6)?,
            status: BillStatus::Upcoming,
            days_late: 0,
        },
        completed_at: r.get(7)?,
        paid_today: r.get(8)?,
    })
}

/// Today's status, or None for a once bill paid before today. One payment
/// covers one period, so a bill still due before today stays overdue.
fn status(due_at: i64, completed_at: Option<i64>, paid_today: bool, start: i64, end: i64) -> Option<BillStatus> {
    match completed_at {
        Some(at) if at >= start => Some(BillStatus::PaidToday),
        Some(_) => None,
        None if due_at < start => Some(BillStatus::Overdue),
        None if paid_today => Some(BillStatus::PaidToday),
        None if due_at < end => Some(BillStatus::DueToday),
        None => Some(BillStatus::Upcoming),
    }
}

fn finish(raw: Raw, now: i64, tz: &TimeZone) -> Result<Option<BillView>, AppError> {
    let (start, end) = day_bounds(now, tz)?;
    let Some(status) = status(raw.view.due_at, raw.completed_at, raw.paid_today, start, end) else {
        return Ok(None);
    };
    let days_late = if status == BillStatus::Overdue {
        i64::from(local_date(raw.view.due_at, tz)?.until(local_date(now, tz)?)?.get_days())
    } else {
        0
    };
    Ok(Some(BillView { status, days_late, ..raw.view }))
}

/// Live bills that are not finished, by due date.
pub fn list_bills(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Vec<BillView>, AppError> {
    let (start, end) = day_bounds(now, tz)?;
    let mut stmt = conn.prepare(&format!("{BILL_SELECT} ORDER BY i.due_at, i.title COLLATE NOCASE, i.id"))?;
    let raws = stmt.query_map(params![start, end], raw_from_row)?.collect::<Result<Vec<_>, _>>()?;
    let mut bills = Vec::new();
    for raw in raws {
        if let Some(bill) = finish(raw, now, tz)? {
            bills.push(bill);
        }
    }
    Ok(bills)
}

pub fn get_bill(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<BillView, AppError> {
    let (start, end) = day_bounds(now, tz)?;
    let raw = conn
        .query_row(&format!("{BILL_SELECT} AND i.id = ?3"), params![start, end, id], raw_from_row)
        .optional()?
        .ok_or(AppError::NotFound)?;
    finish(raw, now, tz)?.ok_or(AppError::NotFound)
}

pub fn save_bill(conn: &Connection, input: &BillInput, now: i64, tz: &TimeZone) -> Result<BillView, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(invalid("Nama tagihan tidak boleh kosong"));
    }
    finance::positive(input.amount)?;
    finance::require_live_account(conn, &input.account_id)?;
    let due_day = local_date(input.due_at, tz)?.day();

    let tx = conn.unchecked_transaction()?;
    let id = match &input.id {
        None => {
            let id = items::insert(&tx, "bill", name, "", now)?;
            tx.execute("UPDATE items SET due_at = ?2 WHERE id = ?1", params![id, input.due_at])?;
            tx.execute(
                "INSERT INTO bills (item_id, account_id, amount, repeat, due_day) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, input.account_id, input.amount, input.repeat, due_day],
            )?;
            id
        }
        Some(id) => {
            get_bill(&tx, id, now, tz)?;
            tx.execute(
                "UPDATE items SET title = ?2, due_at = ?3, updated_at = ?4 WHERE id = ?1",
                params![id, name, input.due_at, now],
            )?;
            tx.execute(
                "UPDATE bills SET account_id = ?2, amount = ?3, repeat = ?4, due_day = ?5 WHERE item_id = ?1",
                params![id, input.account_id, input.amount, input.repeat, due_day],
            )?;
            id.clone()
        }
    };
    tx.commit()?;
    get_bill(conn, &id, now, tz)
}

/// "Tandai lunas": records the expense today, then moves a monthly bill to its
/// next due date or finishes a once bill, in one SQLite transaction.
// ponytail: deleting the payment does not move the due date back; the bill form
// can. Link them both ways if that turns out to confuse people.
pub fn pay_bill(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<TransactionView, AppError> {
    let bill = get_bill(conn, id, now, tz)?;
    if bill.status == BillStatus::PaidToday {
        return Err(invalid("Tagihan ini sudah dibayar hari ini"));
    }
    finance::require_live_account(conn, &bill.account_id)?;
    let (today, _) = day_bounds(now, tz)?;
    let due_day: i8 = conn.query_row("SELECT due_day FROM bills WHERE item_id = ?1", [id], |r| r.get(0))?;

    let tx = conn.unchecked_transaction()?;
    let expense = NewTransaction {
        title: &bill.name,
        body: "",
        account_id: &bill.account_id,
        amount: -bill.amount,
        category: Some(BILL_CATEGORY),
        occurred_at: today,
        transfer_id: None,
        bill_id: Some(id),
    };
    let paid = finance::insert_transaction(&tx, &expense, now)?;
    if bill.repeat == Repeat::Monthly {
        let next = next_month_due(bill.due_at, due_day, tz)?;
        tx.execute("UPDATE items SET due_at = ?2, updated_at = ?3 WHERE id = ?1", params![id, next, now])?;
    } else {
        tx.execute("UPDATE items SET completed_at = ?2, updated_at = ?2 WHERE id = ?1", params![id, now])?;
    }
    tx.commit()?;
    finance::get_transaction(conn, &paid, now, tz)
}

/// Soft-deletes the bill. Its past payments stay.
pub fn delete_bill(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<(), AppError> {
    get_bill(conn, id, now, tz)?;
    items::soft_delete(conn, id, now)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::finance::testing::*;
    use crate::finance::{delete_account, delete_transaction, get_account};

    const DAY: i64 = 86_400_000;

    fn bill(conn: &Connection, account_id: &str, name: &str, amount: i64, repeat: Repeat, due: &str) -> BillView {
        let input =
            BillInput { name: name.into(), amount, account_id: account_id.into(), repeat, due_at: ms(due), ..Default::default() };
        save_bill(conn, &input, now(), &jakarta()).unwrap()
    }

    #[test]
    fn status_covers_every_case() {
        let (start, end) = (100, 200);
        assert_eq!(status(50, None, false, start, end), Some(BillStatus::Overdue));
        assert_eq!(status(50, None, true, start, end), Some(BillStatus::Overdue));
        assert_eq!(status(300, None, true, start, end), Some(BillStatus::PaidToday));
        assert_eq!(status(150, None, false, start, end), Some(BillStatus::DueToday));
        assert_eq!(status(300, None, false, start, end), Some(BillStatus::Upcoming));
        assert_eq!(status(150, Some(120), true, start, end), Some(BillStatus::PaidToday));
        assert_eq!(status(50, Some(90), false, start, end), None);
    }

    #[test]
    fn paying_a_monthly_bill_records_the_expense_and_moves_the_due_date() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        let listrik = bill(&conn, &bca, "Listrik", 150_000, Repeat::Monthly, "2026-09-28T00:00:00+07:00");
        assert_eq!((listrik.status, listrik.days_late), (BillStatus::Overdue, 1));

        let paid = pay_bill(&conn, &listrik.id, now(), &jakarta()).unwrap();

        assert_eq!((paid.amount, paid.category.as_deref(), paid.title.as_str()), (-150_000, Some("Tagihan"), "Listrik"));
        assert_eq!((paid.bill_id.as_deref(), paid.occurred_at), (Some(listrik.id.as_str()), ms("2026-09-29T00:00:00+07:00")));
        let after = get_bill(&conn, &listrik.id, now(), &jakarta()).unwrap();
        assert_eq!((after.due_at, after.status), (ms("2026-10-28T00:00:00+07:00"), BillStatus::PaidToday));
        assert_eq!(get_account(&conn, &bca, now(), &jakarta()).unwrap().balance, 850_000);
        assert!(matches!(pay_bill(&conn, &listrik.id, now(), &jakarta()), Err(AppError::Invalid(_))));
        assert_eq!(get_bill(&conn, &listrik.id, now() + DAY, &jakarta()).unwrap().status, BillStatus::Upcoming);
    }

    #[test]
    fn one_payment_covers_one_period() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let kos = bill(&conn, &bca, "Kos", 1_000_000, Repeat::Monthly, "2026-01-31T00:00:00+07:00");

        pay_bill(&conn, &kos.id, now(), &jakarta()).unwrap();
        let after_one = get_bill(&conn, &kos.id, now(), &jakarta()).unwrap();
        pay_bill(&conn, &kos.id, now(), &jakarta()).unwrap();
        let after_two = get_bill(&conn, &kos.id, now(), &jakarta()).unwrap();

        assert_eq!((after_one.due_at, after_one.status), (ms("2026-02-28T00:00:00+07:00"), BillStatus::Overdue));
        assert_eq!(after_two.due_at, ms("2026-03-31T00:00:00+07:00"));
    }

    #[test]
    fn once_bill_is_done_after_payment() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let servis = bill(&conn, &bca, "Servis motor", 300_000, Repeat::Once, "2026-09-29T00:00:00+07:00");
        assert_eq!(servis.status, BillStatus::DueToday);

        pay_bill(&conn, &servis.id, now(), &jakarta()).unwrap();

        assert_eq!(list_bills(&conn, now(), &jakarta()).unwrap()[0].status, BillStatus::PaidToday);
        assert!(list_bills(&conn, now() + DAY, &jakarta()).unwrap().is_empty());
        assert!(matches!(get_bill(&conn, &servis.id, now() + DAY, &jakarta()), Err(AppError::NotFound)));
    }

    #[test]
    fn bills_are_listed_by_due_date_and_can_be_edited() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let internet = bill(&conn, &bca, "Internet", 250_000, Repeat::Monthly, "2026-10-05T00:00:00+07:00");
        bill(&conn, &bca, "Listrik", 150_000, Repeat::Monthly, "2026-09-28T00:00:00+07:00");
        let names: Vec<String> = list_bills(&conn, now(), &jakarta()).unwrap().into_iter().map(|b| b.name).collect();
        assert_eq!(names, ["Listrik", "Internet"]);

        let input = BillInput {
            id: Some(internet.id.clone()),
            name: " Internet rumah ".into(),
            amount: 300_000,
            account_id: bca.clone(),
            repeat: Repeat::Monthly,
            due_at: ms("2026-10-07T00:00:00+07:00"),
        };
        let edited = save_bill(&conn, &input, now(), &jakarta()).unwrap();

        assert_eq!(
            (edited.name.as_str(), edited.amount, edited.status, edited.account_name.as_str()),
            ("Internet rumah", 300_000, BillStatus::Upcoming, "BCA")
        );
        let due_day: i64 = conn.query_row("SELECT due_day FROM bills WHERE item_id = ?1", [&internet.id], |r| r.get(0)).unwrap();
        assert_eq!(due_day, 7);
        delete_bill(&conn, &internet.id, now(), &jakarta()).unwrap();
        assert_eq!(list_bills(&conn, now(), &jakarta()).unwrap().len(), 1);
    }

    #[test]
    fn bill_input_is_validated() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let base = || BillInput { name: "Listrik".into(), amount: 1_000, account_id: bca.clone(), ..Default::default() };
        for bad in [
            BillInput { name: "  ".into(), ..base() },
            BillInput { amount: 0, ..base() },
            BillInput { account_id: "nope".into(), ..base() },
        ] {
            assert!(matches!(save_bill(&conn, &bad, now(), &jakarta()), Err(AppError::Invalid(_))));
        }
    }

    #[test]
    fn account_with_a_bill_cannot_be_deleted() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let listrik = bill(&conn, &bca, "Listrik", 150_000, Repeat::Monthly, "2026-10-05T00:00:00+07:00");
        assert!(matches!(delete_account(&conn, &bca, now(), &jakarta()), Err(AppError::AccountInUse)));

        delete_bill(&conn, &listrik.id, now(), &jakarta()).unwrap();
        delete_account(&conn, &bca, now(), &jakarta()).unwrap();
    }

    #[test]
    fn deleting_the_payment_keeps_the_new_due_date() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let listrik = bill(&conn, &bca, "Listrik", 150_000, Repeat::Monthly, "2026-09-28T00:00:00+07:00");
        let paid = pay_bill(&conn, &listrik.id, now(), &jakarta()).unwrap();

        delete_transaction(&conn, &paid.id, now(), &jakarta()).unwrap();

        let after = get_bill(&conn, &listrik.id, now(), &jakarta()).unwrap();
        assert_eq!((after.due_at, after.status), (ms("2026-10-28T00:00:00+07:00"), BillStatus::Upcoming));
    }

    #[test]
    fn bill_status_and_payments_follow_exact_jakarta_day_boundaries() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 10);
        let due = bill(&conn, &bca, "Air", 1, Repeat::Monthly, "2026-09-30T00:00:00+07:00");
        let midnight = due.due_at;
        assert_eq!(get_bill(&conn, &due.id, midnight - 1, &jakarta()).unwrap().status, BillStatus::Upcoming);
        assert_eq!(get_bill(&conn, &due.id, midnight, &jakarta()).unwrap().status, BillStatus::DueToday);
        assert_eq!(get_bill(&conn, &due.id, midnight + DAY - 1, &jakarta()).unwrap().status, BillStatus::DueToday);
        let late = get_bill(&conn, &due.id, midnight + DAY, &jakarta()).unwrap();
        assert_eq!((late.status, late.days_late), (BillStatus::Overdue, 1));
        let paid = pay_bill(&conn, &due.id, midnight + DAY, &jakarta()).unwrap();
        assert_eq!(paid.amount, -1);
        assert_eq!(get_bill(&conn, &due.id, midnight + DAY - 1, &jakarta()).unwrap().status, BillStatus::Upcoming);
        assert_eq!(get_bill(&conn, &due.id, midnight + DAY, &jakarta()).unwrap().status, BillStatus::PaidToday);
        assert_eq!(get_bill(&conn, &due.id, midnight + 2 * DAY, &jakarta()).unwrap().status, BillStatus::Upcoming);
    }

    #[test]
    fn deleted_bills_are_not_found_by_read_write_or_payment_paths() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 10);
        let gone = bill(&conn, &bca, "Air", 1, Repeat::Monthly, "2026-09-29T00:00:00+07:00");
        delete_bill(&conn, &gone.id, now(), &jakarta()).unwrap();
        assert!(list_bills(&conn, now(), &jakarta()).unwrap().is_empty());
        assert!(matches!(get_bill(&conn, &gone.id, now(), &jakarta()), Err(AppError::NotFound)));
        assert!(matches!(pay_bill(&conn, &gone.id, now(), &jakarta()), Err(AppError::NotFound)));
        let edit = BillInput { id: Some(gone.id), name: "Air".into(), account_id: bca.clone(), amount: 1, ..Default::default() };
        assert!(matches!(save_bill(&conn, &edit, now(), &jakarta()), Err(AppError::NotFound)));
        assert_eq!(get_account(&conn, &bca, now(), &jakarta()).unwrap().balance, 10);
    }

    #[test]
    fn wire_names_match_the_frontend() {
        let input: BillInput =
            serde_json::from_str(r#"{"name":"Air","amount":1,"accountId":"a","repeat":"once","dueAt":0}"#).unwrap();
        assert_eq!(input.repeat, Repeat::Once);
        assert!(serde_json::from_str::<BillInput>(r#"{"name":"Air","amount":1,"accountId":"a","repeat":"weekly","dueAt":0}"#).is_err());
        assert_eq!(serde_json::to_string(&BillStatus::DueToday).unwrap(), r#""dueToday""#);
    }
}
