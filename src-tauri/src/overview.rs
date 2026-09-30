//! Month cards, the 6-month cash-flow chart and the monthly spending limit (spec Fase 2 §3, K11).
use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::error::AppError;
use crate::finance::{invalid, list_accounts};
use crate::items;
use crate::time::{add_months, month_bounds, month_of};

/// Bars in the cash-flow chart.
pub const CHART_MONTHS: i32 = 6;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthFlow {
    pub month: String,
    pub income: i64,
    pub expense: i64,
}

/// How much of the monthly limit is spent: under 80%, 80% to 100%, or above.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BudgetLevel {
    Ok,
    Warn,
    Over,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetView {
    pub amount: i64,
    pub level: BudgetLevel,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceOverview {
    pub month: String,
    pub current_month: String,
    pub balance: i64,
    pub account_count: usize,
    pub income: i64,
    pub expense: i64,
    pub net: i64,
    pub budget: Option<BudgetView>,
    pub chart: Vec<MonthFlow>,
}

/// Income and expense of a local month. Transfers count as neither.
pub fn month_flow(conn: &Connection, month: &str, tz: &TimeZone) -> Result<MonthFlow, AppError> {
    let (start, end) = month_bounds(month, tz)?;
    let (income, expense) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0),
                COALESCE(-SUM(CASE WHEN t.amount < 0 THEN t.amount END), 0)
         FROM transactions t JOIN items i ON i.id = t.item_id
         WHERE i.deleted_at IS NULL AND t.transfer_id IS NULL AND t.occurred_at >= ?1 AND t.occurred_at < ?2",
        params![start, end],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(MonthFlow { month: month.to_string(), income, expense })
}

pub fn budget_level(expense: i64, limit: i64) -> BudgetLevel {
    if expense > limit {
        BudgetLevel::Over
    } else if expense * 5 >= limit * 4 {
        BudgetLevel::Warn
    } else {
        BudgetLevel::Ok
    }
}

const LIVE_TOTAL_BUDGET: &str = "
    FROM budgets b JOIN items i ON i.id = b.item_id
    WHERE i.deleted_at IS NULL AND b.category IS NULL
    ORDER BY i.created_at DESC LIMIT 1";

pub fn budget_amount(conn: &Connection) -> Result<Option<i64>, AppError> {
    Ok(conn.query_row(&format!("SELECT b.amount {LIVE_TOTAL_BUDGET}"), [], |r| r.get(0)).optional()?)
}

pub fn budget_view(conn: &Connection, expense: i64) -> Result<Option<BudgetView>, AppError> {
    Ok(budget_amount(conn)?.map(|amount| BudgetView { amount, level: budget_level(expense, amount) }))
}

/// `month: None` means the current local month. The chart ends at the current
/// month, unless the chosen month is older than its six bars.
pub fn overview(conn: &Connection, month: Option<&str>, now: i64, tz: &TimeZone) -> Result<FinanceOverview, AppError> {
    let current = month_of(now, tz)?;
    let month = month.map_or_else(|| current.clone(), str::to_string);
    let flow = month_flow(conn, &month, tz)?;
    let end = if month < add_months(&current, 1 - CHART_MONTHS)? { month.clone() } else { current.clone() };
    let chart = (1 - CHART_MONTHS..=0)
        .map(|n| month_flow(conn, &add_months(&end, n)?, tz))
        .collect::<Result<Vec<_>, _>>()?;
    let accounts = list_accounts(conn, now, tz)?;
    Ok(FinanceOverview {
        month,
        current_month: current,
        balance: accounts.iter().map(|a| a.balance).sum(),
        account_count: accounts.len(),
        income: flow.income,
        expense: flow.expense,
        net: flow.income - flow.expense,
        budget: budget_view(conn, flow.expense)?,
        chart,
    })
}

/// Sets the one monthly limit, or removes it with `None` (spec K11).
pub fn set_budget(conn: &Connection, amount: Option<i64>, now: i64) -> Result<(), AppError> {
    if amount.is_some_and(|a| a <= 0) {
        return Err(invalid("Batas harus lebih dari 0"));
    }
    let tx = conn.unchecked_transaction()?;
    let existing: Option<String> =
        tx.query_row(&format!("SELECT b.item_id {LIVE_TOTAL_BUDGET}"), [], |r| r.get(0)).optional()?;
    match (existing, amount) {
        (Some(id), Some(amount)) => {
            tx.execute("UPDATE budgets SET amount = ?2 WHERE item_id = ?1", params![id, amount])?;
            tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
        }
        (Some(id), None) => {
            items::soft_delete(&tx, &id, now)?;
        }
        (None, Some(amount)) => {
            let id = items::insert(&tx, "budget", "", "", now)?;
            tx.execute("INSERT INTO budgets (item_id, amount) VALUES (?1, ?2)", params![id, amount])?;
        }
        (None, None) => {}
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::finance::testing::*;

    const TODAY: &str = "2026-09-29T00:00:00+07:00";

    #[test]
    fn month_flow_uses_local_bounds_and_skips_transfers() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let gopay = account(&conn, "GoPay", 0);
        spend(&conn, &bca, 20_000, "Makan & minum", "2026-09-01T00:00:00+07:00");
        spend(&conn, &bca, 30_000, "Makan & minum", "2026-09-30T00:00:00+07:00");
        spend(&conn, &bca, 99_000, "Belanja", "2026-10-01T00:00:00+07:00"); // 30 Sep 17:00 UTC
        spend(&conn, &bca, 7_000, "Belanja", "2026-08-31T00:00:00+07:00");
        earn(&conn, &bca, 8_000_000, "2026-09-25T00:00:00+07:00");
        transfer(&conn, &bca, &gopay, 100_000, "2026-09-10T00:00:00+07:00");

        let flow = month_flow(&conn, "2026-09", &jakarta()).unwrap();

        assert_eq!(flow, MonthFlow { month: "2026-09".into(), income: 8_000_000, expense: 50_000 });
    }

    #[test]
    fn overview_fills_the_cards_and_a_six_month_chart() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        spend(&conn, &bca, 25_000, "Makan & minum", TODAY);
        earn(&conn, &bca, 1_500_000, "2026-04-25T00:00:00+07:00");

        let o = overview(&conn, None, now(), &jakarta()).unwrap();

        assert_eq!((o.month.as_str(), o.current_month.as_str()), ("2026-09", "2026-09"));
        assert_eq!((o.balance, o.account_count, o.income, o.expense, o.net), (2_475_000, 1, 0, 25_000, -25_000));
        let months: Vec<&str> = o.chart.iter().map(|m| m.month.as_str()).collect();
        assert_eq!(months, ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
        assert_eq!((o.chart[0].income, o.chart[5].expense), (1_500_000, 25_000));
        assert_eq!(o.budget, None);
    }

    #[test]
    fn chart_ends_at_an_older_chosen_month() {
        let conn = open_in_memory();
        let inside = overview(&conn, Some("2026-05"), now(), &jakarta()).unwrap();
        assert_eq!((inside.month.as_str(), inside.chart[5].month.as_str()), ("2026-05", "2026-09"));

        let older = overview(&conn, Some("2026-01"), now(), &jakarta()).unwrap();
        assert_eq!((older.chart[0].month.as_str(), older.chart[5].month.as_str()), ("2025-08", "2026-01"));

        assert!(matches!(overview(&conn, Some("2026-13"), now(), &jakarta()), Err(AppError::Invalid(_))));
    }

    #[test]
    fn budget_level_thresholds() {
        assert_eq!(budget_level(79_000, 100_000), BudgetLevel::Ok);
        assert_eq!(budget_level(80_000, 100_000), BudgetLevel::Warn);
        assert_eq!(budget_level(100_000, 100_000), BudgetLevel::Warn);
        assert_eq!(budget_level(100_001, 100_000), BudgetLevel::Over);
        assert_eq!(serde_json::to_string(&BudgetLevel::Warn).unwrap(), r#""warn""#);
    }

    #[test]
    fn budget_can_be_set_changed_and_removed() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        spend(&conn, &bca, 175_000, "Belanja", TODAY);

        set_budget(&conn, Some(200_000), now()).unwrap();
        let expected = Some(BudgetView { amount: 200_000, level: BudgetLevel::Warn });
        assert_eq!(overview(&conn, None, now(), &jakarta()).unwrap().budget, expected);

        set_budget(&conn, Some(150_000), now()).unwrap();
        assert_eq!(budget_amount(&conn).unwrap(), Some(150_000));
        let live: i64 = conn
            .query_row("SELECT COUNT(*) FROM budgets b JOIN items i ON i.id = b.item_id WHERE i.deleted_at IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(live, 1);

        set_budget(&conn, None, now()).unwrap();
        assert_eq!(budget_amount(&conn).unwrap(), None);
        assert!(matches!(set_budget(&conn, Some(0), now()), Err(AppError::Invalid(_))));
    }
}
